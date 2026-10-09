import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ohlcv } from '../database/entities/ohlcv.entity';
import { Token } from '../database/entities/token.entity';
import {
  CandleData,
  IndicatorPoint,
  ChartMarker,
  RecentBuySignal,
  ScanBuySignalsResult,
} from './angloritma.service';

/**
 * Angloritma v2 — Regime-Adaptive Multi-Factor strategy (long-only).
 *
 * Score (0-100) built from 5 factor groups:
 *   - Market regime   (20): BTC above EMA50 + market breadth (% tokens above EMA50)
 *   - Trend           (25): close > EMA50, EMA20 > EMA50, EMA50 slope up, ADX > 20
 *   - Relative str.   (20): percentile rank of N-bar return across the whole token universe
 *   - Momentum        (15): RSI in healthy zone, recent pullback reset, MACD histogram turning up
 *   - Volume / flow   (20): volume spike vs 20-bar avg, OBV above its EMA, quote-volume expansion
 *
 * BUY  = score >= threshold AND breakout trigger (close > prior 10-bar high, bullish candle,
 *        volume >= 1.2x avg) AND close > EMA50 AND flat.
 * EXIT = ATR stop (1.5 ATR) | TP1 at +2R (50% off, stop -> breakeven) | Chandelier trail (3 ATR)
 *        | trend break (close < EMA50) | regime risk-off | time stop (30 bars without +1R).
 * Costs: 0.1% fee + 0.05% slippage per side are deducted from every trade.
 */

export type V2ExitType = 'SL' | 'BE' | 'TRAIL' | 'SIGNAL' | 'REGIME' | 'TIME';

export interface V2Trade {
  tradeId: number;
  entryTime: number;
  entryIsoTime: string;
  entryPrice: number;
  exitTime: number;
  exitIsoTime: string;
  exitPrice: number; // final exit price (remaining size)
  exitType: V2ExitType;
  tp1Hit: boolean;
  pnlPct: number; // net of costs, blended over partial exits
  rMultiple: number;
  durationBars: number;
  entryScore: number;
}

export interface V2Factors {
  regime: number;
  trend: number;
  relativeStrength: number;
  momentum: number;
  volume: number;
}

export interface V2Params {
  scoreThreshold: number;
  atrStopMult: number;
  tp1R: number;
  trailAtrMult: number;
  timeStopBars: number;
  feePct: number;
  slippagePct: number;
}

export interface V2Result {
  algorithm: 'v2';
  symbol: string;
  timeframe: string;
  token: Partial<Token> | null;
  params: V2Params;
  candles: CandleData[];
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  stopLine: { time: number; value?: number }[]; // whitespace points (no value) create gaps
  score: { time: number; value: number; color: string }[];
  markers: ChartMarker[];
  trades: V2Trade[];
  activePosition: {
    inPosition: boolean;
    entryTime?: number;
    entryPrice?: number;
    takeProfitPrice?: number; // TP1
    stopLossPrice?: number; // current (trailing) stop
    tp1Hit?: boolean;
    currentPrice?: number;
    unrealizedPnlPct?: number;
  };
  stats: {
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    winRatePct: number;
    totalPnlPct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    expectancyR: number;
    avgHoldBars: number;
  };
  currentStatus: {
    lastPrice: number;
    score: number;
    factors: V2Factors;
    btcRiskOn: boolean;
    breadthPct: number;
    rsPercentile: number;
    ema20: number | null;
    ema50: number | null;
    atr: number | null;
    rsi: number | null;
    adx: number | null;
    latestSignal: 'BUY' | 'SELL' | 'NEUTRAL';
  };
}

interface UniverseStats {
  builtAt: number;
  breadth: Map<number, number>; // time -> fraction of tokens above EMA50
  rsPct: Map<string, Map<number, number>>; // symbol -> time -> percentile 0..1
  btcRiskOn: Map<number, boolean>; // time -> BTC close > EMA50
}

const DEFAULT_PARAMS: V2Params = {
  scoreThreshold: 70,
  atrStopMult: 1.5,
  tp1R: 2,
  trailAtrMult: 3,
  timeStopBars: 30,
  feePct: 0.1,
  slippagePct: 0.05,
};

const TF_SECONDS: Record<string, number> = { '1h': 3600, '4h': 14400, '1d': 86400 };

import { KrakenService } from '../kraken/kraken.service';

@Injectable()
export class MultiFactorService {
  private readonly logger = new Logger(MultiFactorService.name);
  private universeCache = new Map<string, UniverseStats>();
  private readonly UNIVERSE_TTL_MS = 5 * 60 * 1000;
  private scanCache = new Map<string, { timestamp: number; data: ScanBuySignalsResult }>();

  constructor(
    @InjectRepository(Ohlcv)
    private readonly ohlcvRepo: Repository<Ohlcv>,
    @InjectRepository(Token)
    private readonly tokenRepo: Repository<Token>,
    private readonly krakenService: KrakenService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  async compute(
    symbol: string,
    timeframe: '4h' | '1d',
    overrides: Partial<V2Params> = {},
    limit = 500,
  ): Promise<V2Result> {
    const params: V2Params = { ...DEFAULT_PARAMS, ...overrides };
    const sym = symbol.toUpperCase();
    const token = await this.tokenRepo.findOne({ where: { symbol: sym } });

    const rows = (
      await this.ohlcvRepo.find({
        where: { symbol: sym, timeframe },
        order: { openTime: 'DESC' },
        take: limit,
      })
    ).reverse();
    if (rows.length < 60) {
      throw new Error(`Not enough candle data for ${sym} on ${timeframe} (${rows.length} bars, need 60)`);
    }

    let candles: CandleData[] = rows.map((r) => ({
      time: Math.floor(new Date(r.openTime).getTime() / 1000),
      isoTime: new Date(r.openTime).toISOString(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
    let quoteVol = rows.map((r) => Number(r.quoteVolume));

    try {
      const pair = await this.krakenService.getPairBySymbol(sym);
      if (pair) {
        const lastDbTimeSec = candles[candles.length - 1].time;
        const liveCandles = await this.krakenService.getOhlcv(pair.altname, timeframe, lastDbTimeSec, Math.floor(Date.now() / 1000) + 100);
        
        for (const lc of liveCandles) {
          const currentLastTime = candles[candles.length - 1].time;
          if (lc.openTime > currentLastTime) {
            candles.push({
              time: lc.openTime,
              isoTime: new Date(lc.openTime * 1000).toISOString(),
              open: parseFloat(lc.open),
              high: parseFloat(lc.high),
              low: parseFloat(lc.low),
              close: parseFloat(lc.close),
              volume: parseFloat(lc.volume),
            });
            quoteVol.push(parseFloat(lc.quoteVolume));
          } else if (lc.openTime === currentLastTime) {
            const idx = candles.length - 1;
            candles[idx].high = Math.max(candles[idx].high, parseFloat(lc.high));
            candles[idx].low = Math.min(candles[idx].low, parseFloat(lc.low));
            candles[idx].close = parseFloat(lc.close);
            candles[idx].volume = parseFloat(lc.volume);
            quoteVol[idx] = parseFloat(lc.quoteVolume);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch live candle for ${sym}: ${err.message}`);
    }

    const universe = await this.getUniverse(timeframe);

    return this.simulate(sym, timeframe, token, candles, quoteVol, universe, params);
  }

  /** Scan all active tokens for v2 BUY signals in the last N days. */
  async scanRecentBuySignals(options?: {
    timeframe?: '4h' | '1d' | 'all';
    days?: number;
    status?: 'all' | 'active' | 'tp' | 'sl';
  }): Promise<ScanBuySignalsResult> {
    const tfOption = options?.timeframe || 'all';
    const days = Math.max(1, options?.days || 7);
    const statusFilter = options?.status || 'all';

    const cacheKey = `${tfOption}_${days}_${statusFilter}`;
    const cached = this.scanCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.UNIVERSE_TTL_MS) return cached.data;

    const maxRow = await this.ohlcvRepo.query('SELECT max(open_time) AS max_date FROM ohlcv');
    const latestSec = Math.floor(new Date(maxRow?.[0]?.max_date ?? Date.now()).getTime() / 1000);
    const cutoffSec = latestSec - days * 86400;

    const tokens = await this.tokenRepo.find({ where: { isActive: true }, order: { volumeRank: 'ASC' } });
    const tfs: ('4h' | '1d')[] = tfOption === 'all' ? ['4h', '1d'] : [tfOption];
    const signals: RecentBuySignal[] = [];

    for (const tf of tfs) {
      const results = await this.runForAll(tokens, tf, 300);
      for (const { tok, res } of results) {
        const buys = res.markers.filter((m) => m.text.startsWith('BUY') && m.time >= cutoffSec);
        for (const bm of buys) {
          const trade = res.trades.find((t) => t.entryTime === bm.time);
          const isActive = res.activePosition.inPosition && res.activePosition.entryTime === bm.time;
          const status: RecentBuySignal['status'] = trade
            ? trade.pnlPct > 0
              ? 'HIT_TP'
              : 'HIT_SL'
            : 'ACTIVE';
          if (!trade && !isActive) continue;
          if (statusFilter === 'active' && status !== 'ACTIVE') continue;
          if (statusFilter === 'tp' && status !== 'HIT_TP') continue;
          if (statusFilter === 'sl' && status !== 'HIT_SL') continue;

          const entryP = trade ? trade.entryPrice : res.activePosition.entryPrice!;
          const currP = res.currentStatus.lastPrice;
          const atrAtEntry = trade
            ? (trade.entryPrice - (trade.entryPrice - 0)) // placeholder, replaced below
            : 0;
          void atrAtEntry;
          signals.push({
            symbol: tok.symbol,
            baseAsset: tok.baseAsset,
            quoteAsset: tok.quoteAsset,
            volumeRank: tok.volumeRank,
            timeframe: tf,
            signalTime: bm.time,
            signalIsoTime: new Date(bm.time * 1000).toISOString(),
            ageHours: Math.max(0, Math.round((latestSec - bm.time) / 3600)),
            entryPrice: this.round(entryP),
            currentPrice: this.round(currP),
            priceChangeSinceEntryPct: Number((((currP - entryP) / entryP) * 100).toFixed(2)),
            takeProfitPrice: this.round(isActive ? res.activePosition.takeProfitPrice! : entryP),
            stopLossPrice: this.round(isActive ? res.activePosition.stopLossPrice! : entryP),
            status,
            exitTime: trade?.exitTime,
            exitIsoTime: trade?.exitIsoTime,
            exitPrice: trade ? this.round(trade.exitPrice) : undefined,
            realizedPnlPct: trade?.pnlPct,
            isQuantBlue: res.currentStatus.score >= res.params.scoreThreshold,
            quantSma: res.currentStatus.score,
            ema13: res.currentStatus.ema20,
            ema21: res.currentStatus.ema50,
            winRatePct: res.stats.winRatePct,
            totalPnlPct: res.stats.totalPnlPct,
            totalTrades: res.stats.totalTrades,
          });
        }
      }
    }

    signals.sort((a, b) => b.signalTime - a.signalTime);
    const data: ScanBuySignalsResult = {
      totalCount: signals.length,
      activeCount: signals.filter((s) => s.status === 'ACTIVE').length,
      hitTpCount: signals.filter((s) => s.status === 'HIT_TP').length,
      hitSlCount: signals.filter((s) => s.status === 'HIT_SL').length,
      cutoffTime: new Date(cutoffSec * 1000).toISOString(),
      signals,
    };
    this.scanCache.set(cacheKey, { timestamp: Date.now(), data });
    return data;
  }

  /** Run v2 on every active token for a timeframe (used by scan + backtest compare). */
  async runForAll(tokens: Token[], tf: '4h' | '1d', limit = 500) {
    const out: { tok: Token; res: V2Result }[] = [];
    const batch = 10;
    for (let i = 0; i < tokens.length; i += batch) {
      const settled = await Promise.all(
        tokens.slice(i, i + batch).map(async (tok) => {
          try {
            return { tok, res: await this.compute(tok.symbol, tf, {}, limit) };
          } catch {
            return null;
          }
        }),
      );
      for (const s of settled) if (s) out.push(s);
    }
    return out;
  }

  // ─── Universe (breadth, relative strength, BTC regime) ─────────────────────

  private async getUniverse(timeframe: string): Promise<UniverseStats> {
    const cached = this.universeCache.get(timeframe);
    if (cached && Date.now() - cached.builtAt < this.UNIVERSE_TTL_MS) return cached;

    const tfSec = TF_SECONDS[timeframe] ?? 14400;
    const rows: { symbol: string; t: number; close: string }[] = await this.ohlcvRepo.query(
      `SELECT o.symbol, extract(epoch FROM o.open_time)::bigint AS t, o.close
         FROM ohlcv o JOIN tokens k ON k.symbol = o.symbol AND k.is_active
        WHERE o.timeframe = $1
          AND o.open_time >= (SELECT max(open_time) FROM ohlcv WHERE timeframe = $1) - ($2 || ' seconds')::interval
        ORDER BY o.symbol, o.open_time`,
      [timeframe, String(tfSec * 1100)],
    );

    const bySymbol = new Map<string, { t: number[]; c: number[] }>();
    for (const r of rows) {
      let s = bySymbol.get(r.symbol);
      if (!s) bySymbol.set(r.symbol, (s = { t: [], c: [] }));
      s.t.push(Number(r.t));
      s.c.push(Number(r.close));
    }

    const rsLookback = timeframe === '1d' ? 14 : 42; // ~14 days on 1D, ~7 days on 4H
    const aboveCount = new Map<number, number>();
    const totalCount = new Map<number, number>();
    const retsAtTime = new Map<number, { symbol: string; ret: number }[]>();
    const btcRiskOn = new Map<number, boolean>();

    for (const [symbol, s] of bySymbol) {
      const ema50 = this.ema(s.c, 50);
      for (let i = 0; i < s.c.length; i++) {
        const t = s.t[i];
        if (ema50[i] !== null) {
          totalCount.set(t, (totalCount.get(t) ?? 0) + 1);
          if (s.c[i] > ema50[i]!) aboveCount.set(t, (aboveCount.get(t) ?? 0) + 1);
          if (symbol === 'BTCUSD') btcRiskOn.set(t, s.c[i] > ema50[i]!);
        }
        if (i >= rsLookback) {
          const ret = s.c[i] / s.c[i - rsLookback] - 1;
          let arr = retsAtTime.get(t);
          if (!arr) retsAtTime.set(t, (arr = []));
          arr.push({ symbol, ret });
        }
      }
    }

    const breadth = new Map<number, number>();
    for (const [t, total] of totalCount) {
      if (total >= 10) breadth.set(t, (aboveCount.get(t) ?? 0) / total);
    }

    const rsPct = new Map<string, Map<number, number>>();
    for (const [t, arr] of retsAtTime) {
      if (arr.length < 10) continue;
      arr.sort((a, b) => a.ret - b.ret);
      const n = arr.length;
      arr.forEach((x, idx) => {
        let m = rsPct.get(x.symbol);
        if (!m) rsPct.set(x.symbol, (m = new Map()));
        m.set(t, n > 1 ? idx / (n - 1) : 0.5);
      });
    }

    const stats: UniverseStats = { builtAt: Date.now(), breadth, rsPct, btcRiskOn };
    this.universeCache.set(timeframe, stats);
    this.logger.debug(`Universe built for ${timeframe}: ${bySymbol.size} tokens, ${breadth.size} time points`);
    return stats;
  }

  // ─── Core simulation ───────────────────────────────────────────────────────

  private simulate(
    sym: string,
    timeframe: string,
    token: Token | null,
    candles: CandleData[],
    quoteVol: number[],
    universe: UniverseStats,
    p: V2Params,
  ): V2Result {
    const n = candles.length;
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const vols = candles.map((c) => c.volume);

    const ema20 = this.ema(closes, 20);
    const ema50 = this.ema(closes, 50);
    const atr = this.atr(highs, lows, closes, 14);
    const rsi = this.rsi(closes, 14);
    const adx = this.adx(highs, lows, closes, 14);
    const macdHist = this.macdHist(closes);
    const volSma = this.sma(vols, 20);
    const qv5 = this.sma(quoteVol, 5);
    const qv20 = this.sma(quoteVol, 20);
    const obv = this.obv(closes, vols);
    const obvEma = this.ema(obv, 20);
    const rsMap = universe.rsPct.get(sym);

    const factorsAt = (i: number): V2Factors | null => {
      if (ema50[i] === null || atr[i] === null || i < 10) return null;
      const t = candles[i].time;
      const c = closes[i];

      // Regime (20)
      const riskOn = universe.btcRiskOn.get(t);
      const br = universe.breadth.get(t) ?? 0.5;
      const regime = (riskOn === undefined ? 5 : riskOn ? 10 : 0) + 10 * this.clamp((br - 0.3) / 0.4);

      // Trend (25)
      let trend = 0;
      if (c > ema50[i]!) trend += 8;
      if (ema20[i] !== null && ema20[i]! > ema50[i]!) trend += 7;
      if (ema50[i - 5] !== null && ema50[i]! > ema50[i - 5]!) trend += 5;
      if (adx[i] !== null && adx[i]! > 20) trend += 5;

      // Relative strength (20)
      const rs = rsMap?.get(t) ?? 0.5;
      const relativeStrength = 20 * rs;

      // Momentum (15)
      let momentum = 0;
      if (rsi[i] !== null && rsi[i]! >= 45 && rsi[i]! <= 70) momentum += 5;
      let pulledBack = false;
      for (let k = Math.max(0, i - 10); k < i; k++) if (rsi[k] !== null && rsi[k]! < 50) pulledBack = true;
      if (pulledBack) momentum += 4;
      if (macdHist[i] !== null && macdHist[i]! > 0) momentum += 3;
      if (macdHist[i] !== null && macdHist[i - 1] !== null && macdHist[i]! > macdHist[i - 1]!) momentum += 3;

      // Volume / flow (20)
      let volume = 0;
      const vr = volSma[i] ? vols[i] / volSma[i]! : 1;
      volume += 10 * this.clamp(vr - 1);
      if (obvEma[i] !== null && obv[i] > obvEma[i]!) volume += 5;
      if (qv5[i] !== null && qv20[i] !== null && qv5[i]! > qv20[i]!) volume += 5;

      return { regime, trend, relativeStrength, momentum, volume };
    };
    const total = (f: V2Factors) => f.regime + f.trend + f.relativeStrength + f.momentum + f.volume;

    const costPct = 2 * (p.feePct + p.slippagePct);
    const markers: ChartMarker[] = [];
    const trades: V2Trade[] = [];
    const scorePts: V2Result['score'] = [];
    const stopLine: V2Result['stopLine'] = [];

    let inPos = false;
    let entry = 0;
    let entryIdx = 0;
    let entryScore = 0;
    let R = 0;
    let stop = 0;
    let tp1 = 0;
    let tp1Hit = false;
    let highest = 0;

    const closeTrade = (i: number, exitPrice: number, type: V2ExitType) => {
      const finalPct = ((exitPrice - entry) / entry) * 100;
      const tp1Pct = ((tp1 - entry) / entry) * 100;
      const gross = tp1Hit ? 0.5 * tp1Pct + 0.5 * finalPct : finalPct;
      const net = gross - costPct;
      const rPct = (R / entry) * 100;
      trades.push({
        tradeId: trades.length + 1,
        entryTime: candles[entryIdx].time,
        entryIsoTime: candles[entryIdx].isoTime,
        entryPrice: entry,
        exitTime: candles[i].time,
        exitIsoTime: candles[i].isoTime,
        exitPrice,
        exitType: type,
        tp1Hit,
        pnlPct: Number(net.toFixed(2)),
        rMultiple: Number((net / rPct).toFixed(2)),
        durationBars: i - entryIdx,
        entryScore,
      });
      markers.push({
        time: candles[i].time,
        position: 'aboveBar',
        color: net > 0 ? '#3b82f6' : '#ef4444',
        shape: 'arrowDown',
        text: `${type} (${net >= 0 ? '+' : ''}${net.toFixed(1)}%)`,
        size: 2,
      });
      inPos = false;
    };

    for (let i = 1; i < n; i++) {
      const c = candles[i];
      const f = factorsAt(i);
      const score = f ? total(f) : 0;
      if (f) {
        scorePts.push({
          time: c.time,
          value: Number(score.toFixed(1)),
          color: score >= p.scoreThreshold ? 'rgba(16,185,129,0.55)' : score >= 50 ? 'rgba(234,179,8,0.45)' : 'rgba(239,68,68,0.40)',
        });
      }

      // ── Manage open position (bar i after entry bar) ──
      if (inPos) {
        // 1. Stop (gap-aware)
        if (c.low <= stop) {
          const px = c.open < stop ? c.open : stop;
          closeTrade(i, px, tp1Hit ? (stop > entry ? 'TRAIL' : 'BE') : 'SL');
        } else {
          // 2. TP1 partial
          if (!tp1Hit && c.high >= tp1) {
            tp1Hit = true;
            stop = Math.max(stop, entry);
            markers.push({ time: c.time, position: 'aboveBar', color: '#22d3ee', shape: 'circle', text: 'TP1', size: 1 });
          }
          highest = Math.max(highest, c.high);
          // 3. Chandelier trailing stop (ratchets up only)
          if (atr[i] !== null) stop = Math.max(stop, highest - p.trailAtrMult * atr[i]!);

          const riskOn = universe.btcRiskOn.get(c.time);
          const br = universe.breadth.get(c.time);
          // 4. Signal / regime / time exits on close
          if (ema50[i] !== null && c.close < ema50[i]!) closeTrade(i, c.close, 'SIGNAL');
          else if (riskOn === false && br !== undefined && br < 0.3) closeTrade(i, c.close, 'REGIME');
          else if (!tp1Hit && i - entryIdx >= p.timeStopBars && highest < entry + R) closeTrade(i, c.close, 'TIME');
        }
      }

      // ── Entry ──
      if (!inPos && f && atr[i] !== null && ema50[i] !== null) {
        let swingHigh = -Infinity;
        for (let k = i - 10; k < i; k++) swingHigh = Math.max(swingHigh, highs[k]);
        const vr = volSma[i] ? vols[i] / volSma[i]! : 0;
        const trigger = c.close > swingHigh && c.close > c.open && vr >= 1.2;
        const lastExitIdx = trades.length ? candles.findIndex((x) => x.time === trades[trades.length - 1].exitTime) : -1;
        // Hanya trigger sinyal pada candle yang sudah close (i !== n - 1)
        if (score >= p.scoreThreshold && trigger && c.close > ema50[i]! && lastExitIdx !== i && i !== n - 1) {
          inPos = true;
          entry = c.close;
          entryIdx = i;
          entryScore = Number(score.toFixed(1));
          R = p.atrStopMult * atr[i]!;
          stop = entry - R;
          tp1 = entry + p.tp1R * R;
          tp1Hit = false;
          highest = c.high;
          markers.push({
            time: c.time,
            position: 'belowBar',
            color: '#10b981',
            shape: 'arrowUp',
            text: `BUY ${Math.round(score)}`,
            size: 2,
          });
        }
      }

      stopLine.push(inPos ? { time: c.time, value: Number(stop.toFixed(8)) } : { time: c.time });
    }

    // ── Stats ──
    const wins = trades.filter((t) => t.pnlPct > 0);
    const losses = trades.filter((t) => t.pnlPct <= 0);
    const gain = wins.reduce((a, t) => a + t.pnlPct, 0);
    const loss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
    let peak = 0, run = 0, maxDd = 0;
    for (const t of trades) {
      run += t.pnlPct;
      peak = Math.max(peak, run);
      maxDd = Math.max(maxDd, peak - run);
    }

    const last = candles[n - 1];
    const lastF = factorsAt(n - 1) ?? { regime: 0, trend: 0, relativeStrength: 0, momentum: 0, volume: 0 };
    const lastMarker = markers[markers.length - 1];
    let latestSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (lastMarker && lastMarker.time === last.time) {
      if (lastMarker.text.startsWith('BUY')) latestSignal = 'BUY';
      else if (lastMarker.shape === 'arrowDown') latestSignal = 'SELL';
    }
    const fx = (v: number | null) => (v === null ? null : Number(v.toFixed(6)));

    return {
      algorithm: 'v2',
      symbol: sym,
      timeframe,
      token,
      params: p,
      candles,
      ema20: this.toPoints(candles, ema20),
      ema50: this.toPoints(candles, ema50),
      stopLine,
      score: scorePts,
      markers,
      trades: [...trades].reverse(),
      activePosition: inPos
        ? {
            inPosition: true,
            entryTime: candles[entryIdx].time,
            entryPrice: entry,
            takeProfitPrice: Number(tp1.toFixed(8)),
            stopLossPrice: Number(stop.toFixed(8)),
            tp1Hit,
            currentPrice: last.close,
            unrealizedPnlPct: Number((((last.close - entry) / entry) * 100).toFixed(2)),
          }
        : { inPosition: false, currentPrice: last.close },
      stats: {
        totalTrades: trades.length,
        winTrades: wins.length,
        lossTrades: losses.length,
        winRatePct: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(1)) : 0,
        totalPnlPct: Number(trades.reduce((a, t) => a + t.pnlPct, 0).toFixed(2)),
        profitFactor: loss > 0 ? Number((gain / loss).toFixed(2)) : gain > 0 ? 99 : 0,
        maxDrawdownPct: Number(maxDd.toFixed(2)),
        expectancyR: trades.length ? Number((trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length).toFixed(2)) : 0,
        avgHoldBars: trades.length ? Math.round(trades.reduce((a, t) => a + t.durationBars, 0) / trades.length) : 0,
      },
      currentStatus: {
        lastPrice: last.close,
        score: Number(total(lastF).toFixed(1)),
        factors: {
          regime: Number(lastF.regime.toFixed(1)),
          trend: Number(lastF.trend.toFixed(1)),
          relativeStrength: Number(lastF.relativeStrength.toFixed(1)),
          momentum: Number(lastF.momentum.toFixed(1)),
          volume: Number(lastF.volume.toFixed(1)),
        },
        btcRiskOn: universe.btcRiskOn.get(last.time) ?? false,
        breadthPct: Number(((universe.breadth.get(last.time) ?? 0) * 100).toFixed(1)),
        rsPercentile: Number(((rsMap?.get(last.time) ?? 0.5) * 100).toFixed(1)),
        ema20: fx(ema20[n - 1]),
        ema50: fx(ema50[n - 1]),
        atr: fx(atr[n - 1]),
        rsi: rsi[n - 1] === null ? null : Number(rsi[n - 1]!.toFixed(1)),
        adx: adx[n - 1] === null ? null : Number(adx[n - 1]!.toFixed(1)),
        latestSignal,
      },
    };
  }

  // ─── Indicator helpers (Pine-compatible) ───────────────────────────────────

  private toPoints(candles: CandleData[], vals: (number | null)[]): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    vals.forEach((v, i) => {
      if (v !== null) out.push({ time: candles[i].time, value: Number(v.toFixed(8)) });
    });
    return out;
  }

  private sma(values: number[], len: number): (number | null)[] {
    const out: (number | null)[] = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= len) sum -= values[i - len];
      if (i >= len - 1) out[i] = sum / len;
    }
    return out;
  }

  private ema(values: number[], len: number): (number | null)[] {
    const out: (number | null)[] = new Array(values.length).fill(null);
    if (values.length < len) return out;
    const a = 2 / (len + 1);
    let prev = values.slice(0, len).reduce((s, v) => s + v, 0) / len;
    out[len - 1] = prev;
    for (let i = len; i < values.length; i++) {
      prev = a * values[i] + (1 - a) * prev;
      out[i] = prev;
    }
    return out;
  }

  /** Wilder's RMA over a series that may start with nulls. */
  private rma(values: number[], len: number, startIdx = 0): (number | null)[] {
    const out: (number | null)[] = new Array(values.length).fill(null);
    if (values.length - startIdx < len) return out;
    let prev = 0;
    for (let i = startIdx; i < startIdx + len; i++) prev += values[i];
    prev /= len;
    out[startIdx + len - 1] = prev;
    for (let i = startIdx + len; i < values.length; i++) {
      prev = (prev * (len - 1) + values[i]) / len;
      out[i] = prev;
    }
    return out;
  }

  private atr(h: number[], l: number[], c: number[], len: number): (number | null)[] {
    const tr = h.map((_, i) =>
      i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])),
    );
    return this.rma(tr, len);
  }

  private rsi(c: number[], len: number): (number | null)[] {
    const gains = [0], lossesArr = [0];
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      gains.push(Math.max(d, 0));
      lossesArr.push(Math.max(-d, 0));
    }
    const ag = this.rma(gains, len, 1);
    const al = this.rma(lossesArr, len, 1);
    return c.map((_, i) => {
      if (ag[i] === null || al[i] === null) return null;
      if (al[i] === 0) return 100;
      return 100 - 100 / (1 + ag[i]! / al[i]!);
    });
  }

  private adx(h: number[], l: number[], c: number[], len: number): (number | null)[] {
    const n = c.length;
    const plusDM = [0], minusDM = [0], tr = [h[0] - l[0]];
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1];
      const down = l[i - 1] - l[i];
      plusDM.push(up > down && up > 0 ? up : 0);
      minusDM.push(down > up && down > 0 ? down : 0);
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    }
    const trR = this.rma(tr, len, 1);
    const pR = this.rma(plusDM, len, 1);
    const mR = this.rma(minusDM, len, 1);
    const dx: number[] = new Array(n).fill(0);
    let first = -1;
    for (let i = 0; i < n; i++) {
      if (trR[i] === null || !trR[i]) continue;
      const pdi = (100 * pR[i]!) / trR[i]!;
      const mdi = (100 * mR[i]!) / trR[i]!;
      dx[i] = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
      if (first < 0) first = i;
    }
    if (first < 0) return new Array(n).fill(null);
    return this.rma(dx, len, first);
  }

  private macdHist(c: number[]): (number | null)[] {
    const e12 = this.ema(c, 12);
    const e26 = this.ema(c, 26);
    const macd: number[] = [];
    let start = -1;
    for (let i = 0; i < c.length; i++) {
      if (e12[i] !== null && e26[i] !== null) {
        if (start < 0) start = i;
        macd.push(e12[i]! - e26[i]!);
      }
    }
    const out: (number | null)[] = new Array(c.length).fill(null);
    if (start < 0) return out;
    const sig = this.ema(macd, 9);
    for (let k = 0; k < macd.length; k++) if (sig[k] !== null) out[start + k] = macd[k] - sig[k]!;
    return out;
  }

  private obv(c: number[], v: number[]): number[] {
    const out = [0];
    for (let i = 1; i < c.length; i++) {
      out.push(out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
    }
    return out;
  }

  private clamp(x: number, lo = 0, hi = 1) {
    return Math.max(lo, Math.min(hi, x));
  }

  private round(x: number) {
    return Number(x.toFixed(x >= 1 ? 4 : 8));
  }
}
