import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ohlcv } from '../database/entities/ohlcv.entity';
import { Token } from '../database/entities/token.entity';

export interface CandleData {
  time: number; // Unix timestamp in seconds for lightweight-charts
  isoTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface QuantPoint {
  time: number;
  value: number;
  isBlue: boolean;
}

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
  size?: number;
}

export interface SimulatedTrade {
  tradeId: number;
  entryTime: number;
  entryIsoTime: string;
  entryPrice: number;
  exitTime: number;
  exitIsoTime: string;
  exitPrice: number;
  exitType: 'TP' | 'SL';
  pnlPct: number;
  durationBars: number;
}

export interface ActivePosition {
  inPosition: boolean;
  entryTime?: number;
  entryPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  currentPrice?: number;
  unrealizedPnlPct?: number;
}

export interface StrategyStats {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRatePct: number;
  totalPnlPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
}

export interface RecentBuySignal {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  volumeRank: number;
  timeframe: '4h' | '1d';
  signalTime: number; // Unix seconds
  signalIsoTime: string;
  ageHours: number;
  entryPrice: number;
  currentPrice: number;
  priceChangeSinceEntryPct: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  status: 'ACTIVE' | 'HIT_TP' | 'HIT_SL';
  exitTime?: number;
  exitIsoTime?: string;
  exitPrice?: number;
  realizedPnlPct?: number;
  isQuantBlue: boolean;
  quantSma: number | null;
  ema13: number | null;
  ema21: number | null;
  winRatePct: number;
  totalPnlPct: number;
  totalTrades: number;
}

export interface ScanBuySignalsResult {
  totalCount: number;
  activeCount: number;
  hitTpCount: number;
  hitSlCount: number;
  cutoffTime: string;
  signals: RecentBuySignal[];
}

export interface AngloritmaResult {
  symbol: string;
  timeframe: string;
  entryMode: 'flexible' | 'strict';
  takeProfitPct: number;
  stopLossPct: number;
  token: Partial<Token> | null;
  candles: CandleData[];
  ema13: IndicatorPoint[];
  ema21: IndicatorPoint[];
  quantSma: QuantPoint[];
  markers: ChartMarker[];
  trades: SimulatedTrade[];
  activePosition: ActivePosition;
  stats: StrategyStats;
  currentStatus: {
    lastPrice: number;
    ema13: number | null;
    ema21: number | null;
    quantSma: number | null;
    isQuantBlue: boolean;
    quantColor: 'blue' | 'yellow';
    bullishCross: boolean;
    bearishCross: boolean;
    latestSignal: 'BUY' | 'SELL_TP' | 'SELL_SL' | 'NEUTRAL';
  };
}

import { KrakenService } from '../kraken/kraken.service';

@Injectable()
export class AngloritmaService {
  private readonly logger = new Logger(AngloritmaService.name);

  constructor(
    @InjectRepository(Ohlcv)
    private readonly ohlcvRepo: Repository<Ohlcv>,
    @InjectRepository(Token)
    private readonly tokenRepo: Repository<Token>,
    private readonly krakenService: KrakenService,
  ) {}

  /**
   * Calculate EMAs, Quant SMA, generate signals and backtest trades
   * according to the Pine Script logic from `angloritma_signal.txt`.
   */
  async computeAngloritma(
    symbol: string,
    timeframe: '4h' | '1d',
    entryMode: 'flexible' | 'strict' = 'flexible',
    takeProfitPct = 5.0,
    stopLossPct = 5.0,
    limit = 500,
    allowRunningCandle = false,
  ): Promise<AngloritmaResult> {
    const sym = symbol.toUpperCase();
    const token = await this.tokenRepo.findOne({ where: { symbol: sym } });

    // Fetch historical candles ordered chronologically (oldest to newest)
    const ohlcvRows = await this.ohlcvRepo.find({
      where: { symbol: sym, timeframe },
      order: { openTime: 'DESC' },
      take: limit,
    });

    const rows = ohlcvRows.reverse();
    if (!rows.length) {
      throw new Error(`No candle data found for ${sym} on timeframe ${timeframe}`);
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
          } else if (lc.openTime === currentLastTime) {
            const idx = candles.length - 1;
            candles[idx].high = Math.max(candles[idx].high, parseFloat(lc.high));
            candles[idx].low = Math.min(candles[idx].low, parseFloat(lc.low));
            candles[idx].close = parseFloat(lc.close);
            candles[idx].volume = parseFloat(lc.volume);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch live candle for ${sym}: ${err.message}`);
    }

    const closes = candles.map((c) => c.close);
    const n = candles.length;

    // ─── 1. EMA 13 & EMA 21 ──────────────────────────────────────────────────
    const ema13Values = this.calculateEma(closes, 13);
    const ema21Values = this.calculateEma(closes, 21);

    // ─── 2. Quant SMA (30 for 1d, 60 for other timeframes like 4h) ───────────
    const lengthPeriod = (timeframe || '').toLowerCase() === '1d' ? 30 : 60;
    const quantSmaValues = this.calculateSma(closes, lengthPeriod);

    // ─── 3. Indicator arrays for Chart ───────────────────────────────────────
    const ema13Points: IndicatorPoint[] = [];
    const ema21Points: IndicatorPoint[] = [];
    const quantPoints: QuantPoint[] = [];

    for (let i = 0; i < n; i++) {
      const t = candles[i].time;
      if (ema13Values[i] !== null) {
        ema13Points.push({ time: t, value: Number(ema13Values[i]!.toFixed(4)) });
      }
      if (ema21Values[i] !== null) {
        ema21Points.push({ time: t, value: Number(ema21Values[i]!.toFixed(4)) });
      }
      if (quantSmaValues[i] !== null) {
        const isBlue = candles[i].close >= quantSmaValues[i]!;
        quantPoints.push({
          time: t,
          value: Number(quantSmaValues[i]!.toFixed(4)),
          isBlue,
        });
      }
    }

    // ─── 4. Strategy Simulation (Exact Pine Script logic) ───────────────────
    const markers: ChartMarker[] = [];
    const trades: SimulatedTrade[] = [];

    let inPosition = false;
    let entryPrice = 0;
    let entryTime = 0;
    let entryIsoTime = '';
    let entryBarIndex = 0;
    let takeProfitPrice = 0;
    let stopLossPrice = 0;
    let tradeCount = 0;
    for (let i = 1; i < n; i++) {
      const c = candles[i];
      const prevC = candles[i - 1];

      const e13 = ema13Values[i];
      const prevE13 = ema13Values[i - 1];
      const e21 = ema21Values[i];
      const prevE21 = ema21Values[i - 1];
      const qSma = quantSmaValues[i];
      const prevQSma = quantSmaValues[i - 1];

      if (e13 === null || prevE13 === null || e21 === null || prevE21 === null || qSma === null || prevQSma === null) {
        continue;
      }

      // Quant Line Status (Pine Script line 50-51)
      const isQuantBlue = c.close >= qSma;
      const prevIsQuantBlue = prevC.close >= prevQSma;
      const quantTurnedBlue = isQuantBlue && !prevIsQuantBlue; // Baru berubah ke biru

      // Bullish / Bearish Cross of EMA (Pine Script line 43-44)
      const bullishCross = prevE13 <= prevE21 && e13 > e21;
      const bearishCross = prevE13 >= prevE21 && e13 < e21;

      // BUY Condition (Pine Script line 57-62)
      let buyCondition = false;
      const isStrict =
        entryMode === 'strict' ||
        (typeof entryMode === 'string' && entryMode.toLowerCase().includes('ketat'));

      if (isStrict) {
        // Ketat (Candle Bersamaan)
        buyCondition = quantTurnedBlue && bullishCross;
      } else {
        // Fleksibel (Konfirmasi)
        buyCondition =
          (quantTurnedBlue && e13 > e21) || (bullishCross && isQuantBlue);
      }

      // Hindari "repainting": Sinyal BUY hanya valid jika candle sudah close.
      // Candle terakhir (live) belum close, sehingga sinyal buy belum konfirm.
      const isLiveCandle = i === candles.length - 1;
      if (isLiveCandle && !allowRunningCandle) {
        buyCondition = false;
      }

      // Track position status at start of this candle (matching Pine Script strategy.position_size)
      const wasInPosition = inPosition;

      // If IN POSITION at start of bar: check Exit / Sell conditions (Pine Script line 77-88)
      if (wasInPosition) {
        // Aturan 3: SELL saat harga CLOSE minimal -5% dari harga entry (Close <= stopLossPrice)
        if (c.close <= stopLossPrice) {
          tradeCount++;
          const pnlPct = ((c.close - entryPrice) / entryPrice) * 100;
          trades.push({
            tradeId: tradeCount,
            entryTime,
            entryIsoTime,
            entryPrice,
            exitTime: c.time,
            exitIsoTime: c.isoTime,
            exitPrice: c.close,
            exitType: 'SL',
            pnlPct: Number(pnlPct.toFixed(2)),
            durationBars: i - entryBarIndex,
          });

          markers.push({
            time: c.time,
            position: 'aboveBar',
            color: '#ef4444',
            shape: 'arrowDown',
            text: `SL (${pnlPct.toFixed(1)}%)`,
            size: 2,
          });

          inPosition = false;
        }
        // Aturan 2: SELL saat running profit menyentuh TP +5% (High >= takeProfitPrice)
        else if (c.high >= takeProfitPrice) {
          tradeCount++;
          const exitPrice = takeProfitPrice;
          const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          trades.push({
            tradeId: tradeCount,
            entryTime,
            entryIsoTime,
            entryPrice,
            exitTime: c.time,
            exitIsoTime: c.isoTime,
            exitPrice,
            exitType: 'TP',
            pnlPct: Number(pnlPct.toFixed(2)),
            durationBars: i - entryBarIndex,
          });

          markers.push({
            time: c.time,
            position: 'aboveBar',
            color: '#3b82f6',
            shape: 'arrowDown',
            text: `TP (+${takeProfitPct}%)`,
            size: 2,
          });

          inPosition = false;
        }
      }

      // If NOT in position at start of bar: check BUY Entry (Pine Script line 66: strategy.position_size == 0)
      if (!wasInPosition && buyCondition) {
        inPosition = true;
        entryPrice = c.close;
        entryTime = c.time;
        entryIsoTime = c.isoTime;
        entryBarIndex = i;
        takeProfitPrice = entryPrice * (1 + takeProfitPct / 100);
        stopLossPrice = entryPrice * (1 - stopLossPct / 100);

        markers.push({
          time: c.time,
          position: 'belowBar',
          color: '#10b981',
          shape: 'arrowUp',
          text: 'BUY',
          size: 2,
        });
      }

      // Subtle cross icon markers (Pine Script lines 114-115)
      if (bullishCross && (!buyCondition || wasInPosition)) {
        markers.push({
          time: c.time,
          position: 'belowBar',
          color: '#06b6d4',
          shape: 'circle',
          text: 'EMA+',
          size: 1,
        });
      } else if (bearishCross && !inPosition) {
        markers.push({
          time: c.time,
          position: 'aboveBar',
          color: '#f97316',
          shape: 'circle',
          text: 'EMA-',
          size: 1,
        });
      }
    }

    // ─── 5. Calculate Backtest Performance Stats ────────────────────────────
    const totalTrades = trades.length;
    const winTrades = trades.filter((t) => t.pnlPct > 0).length;
    const lossTrades = trades.filter((t) => t.pnlPct <= 0).length;
    const winRatePct = totalTrades > 0 ? Number(((winTrades / totalTrades) * 100).toFixed(1)) : 0;
    const totalPnlPct = Number(trades.reduce((acc, t) => acc + t.pnlPct, 0).toFixed(2));

    const totalGain = trades.filter((t) => t.pnlPct > 0).reduce((acc, t) => acc + t.pnlPct, 0);
    const totalLoss = Math.abs(
      trades.filter((t) => t.pnlPct < 0).reduce((acc, t) => acc + t.pnlPct, 0),
    );
    const profitFactor = totalLoss > 0 ? Number((totalGain / totalLoss).toFixed(2)) : totalGain > 0 ? 99 : 0;

    let peakPnl = 0;
    let runningPnl = 0;
    let maxDd = 0;
    for (const t of trades) {
      runningPnl += t.pnlPct;
      if (runningPnl > peakPnl) peakPnl = runningPnl;
      const dd = peakPnl - runningPnl;
      if (dd > maxDd) maxDd = dd;
    }

    const lastCandle = candles[candles.length - 1];
    const lastClose = lastCandle.close;

    const activePosition: ActivePosition = {
      inPosition,
      entryTime: inPosition ? entryTime : undefined,
      entryPrice: inPosition ? entryPrice : undefined,
      takeProfitPrice: inPosition ? Number(takeProfitPrice.toFixed(4)) : undefined,
      stopLossPrice: inPosition ? Number(stopLossPrice.toFixed(4)) : undefined,
      currentPrice: lastClose,
      unrealizedPnlPct: inPosition
        ? Number((((lastClose - entryPrice) / entryPrice) * 100).toFixed(2))
        : undefined,
    };

    // Current status on the most recent bar
    const lastEma13 = ema13Values[n - 1];
    const lastEma21 = ema21Values[n - 1];
    const lastQSma = quantSmaValues[n - 1];
    const lastIsQuantBlue = lastQSma !== null ? lastClose >= lastQSma : false;
    const prevE13Last = n > 1 ? ema13Values[n - 2] : null;
    const prevE21Last = n > 1 ? ema21Values[n - 2] : null;

    const lastBullishCross =
      prevE13Last !== null && prevE21Last !== null && lastEma13 !== null && lastEma21 !== null
        ? prevE13Last <= prevE21Last && lastEma13 > lastEma21
        : false;
    const lastBearishCross =
      prevE13Last !== null && prevE21Last !== null && lastEma13 !== null && lastEma21 !== null
        ? prevE13Last >= prevE21Last && lastEma13 < lastEma21
        : false;

    let latestSignal: 'BUY' | 'SELL_TP' | 'SELL_SL' | 'NEUTRAL' = 'NEUTRAL';
    const lastMarker = markers[markers.length - 1];
    if (lastMarker && lastMarker.time === lastCandle.time) {
      if (lastMarker.text.includes('BUY')) latestSignal = 'BUY';
      else if (lastMarker.text.includes('TP')) latestSignal = 'SELL_TP';
      else if (lastMarker.text.includes('SL')) latestSignal = 'SELL_SL';
    }

    return {
      symbol: sym,
      timeframe,
      entryMode,
      takeProfitPct,
      stopLossPct,
      token,
      candles,
      ema13: ema13Points,
      ema21: ema21Points,
      quantSma: quantPoints,
      markers,
      trades: trades.reverse(), // most recent first
      activePosition,
      stats: {
        totalTrades,
        winTrades,
        lossTrades,
        winRatePct,
        totalPnlPct,
        profitFactor,
        maxDrawdownPct: Number(maxDd.toFixed(2)),
      },
      currentStatus: {
        lastPrice: lastClose,
        ema13: lastEma13 !== null ? Number(lastEma13.toFixed(4)) : null,
        ema21: lastEma21 !== null ? Number(lastEma21.toFixed(4)) : null,
        quantSma: lastQSma !== null ? Number(lastQSma.toFixed(4)) : null,
        isQuantBlue: lastIsQuantBlue,
        quantColor: lastIsQuantBlue ? 'blue' : 'yellow',
        bullishCross: lastBullishCross,
        bearishCross: lastBearishCross,
        latestSignal,
      },
    };
  }

  // ─── Mathematical Helpers ──────────────────────────────────────────────────

  /**
   * EMA calculation matching Pine Script ta.ema:
   * alpha = 2 / (length + 1)
   */
  private calculateEma(values: number[], length: number): (number | null)[] {
    const result: (number | null)[] = new Array(values.length).fill(null);
    if (values.length < length) return result;

    const alpha = 2 / (length + 1);

    // Initial SMA for first value
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += values[i];
    }
    let prevEma = sum / length;
    result[length - 1] = prevEma;

    for (let i = length; i < values.length; i++) {
      const currentEma = alpha * values[i] + (1 - alpha) * prevEma;
      result[i] = currentEma;
      prevEma = currentEma;
    }

    return result;
  }

  /**
   * SMA calculation matching Pine Script ta.sma:
   */
  private calculateSma(values: number[], length: number): (number | null)[] {
    const result: (number | null)[] = new Array(values.length).fill(null);
    if (values.length < length) return result;

    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += values[i];
    }
    result[length - 1] = sum / length;

    for (let i = length; i < values.length; i++) {
      sum += values[i] - values[i - length];
      result[i] = sum / length;
    }

    return result;
  }

  // ─── Scan Recent Buy Signals across all tokens ──────────────────────────────
  private scanCache = new Map<string, { timestamp: number; data: ScanBuySignalsResult }>();
  private readonly SCAN_CACHE_TTL_MS = 30_000; // 30s cache

  /**
   * Scan active tokens for BUY signals that occurred within the last N days.
   * Allows filtering by timeframe ('4h' | '1d' | 'all'), entryMode, and returns
   * active vs completed (TP / SL) statuses.
   */
  async scanRecentBuySignals(options?: {
    timeframe?: '4h' | '1d' | 'all';
    days?: number;
    entryMode?: 'flexible' | 'strict';
    status?: 'all' | 'active' | 'tp' | 'sl';
    allowRunningCandle?: boolean;
  }): Promise<ScanBuySignalsResult> {
    const tfOption = options?.timeframe || 'all';
    const days = Math.max(1, options?.days || 7);
    const mode = options?.entryMode || 'flexible';
    const statusFilter = options?.status || 'all';
    const allowRunning = options?.allowRunningCandle || false;

    const cacheKey = `${tfOption}_${days}_${mode}_${statusFilter}_${allowRunning}`;
    const cached = this.scanCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.SCAN_CACHE_TTL_MS) {
      return cached.data;
    }

    // Determine latest candle time in database
    const maxRow = await this.ohlcvRepo.query('SELECT max(open_time) as max_date FROM ohlcv');
    const latestDate = maxRow?.[0]?.max_date ? new Date(maxRow[0].max_date) : new Date();
    const latestSec = Math.floor(latestDate.getTime() / 1000);
    const cutoffSec = latestSec - days * 24 * 3600;
    const cutoffDate = new Date(cutoffSec * 1000);

    // Get active tokens
    const tokens = await this.tokenRepo.find({
      where: { isActive: true },
      order: { volumeRank: 'ASC' },
    });

    const timeframesToScan: ('4h' | '1d')[] =
      tfOption === '4h' ? ['4h'] : tfOption === '1d' ? ['1d'] : ['4h', '1d'];

    const signals: RecentBuySignal[] = [];

    // Scan tokens in batches of 10 to keep DB concurrency smooth
    const batchSize = 10;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (tok) => {
          for (const tf of timeframesToScan) {
            try {
              const res = await this.computeAngloritma(
                tok.symbol,
                tf,
                mode,
                5.0,
                5.0,
                150, // 150 candles is ample for 7 days
                allowRunning
              );

              // Find BUY markers within the date window
              const buyMarkers = res.markers.filter(
                (m) => m.text.includes('BUY') && m.time >= cutoffSec,
              );

              for (const bm of buyMarkers) {
                // Find corresponding trade or active position
                const completedTrade = res.trades.find((t) => t.entryTime === bm.time);
                const isActive = res.activePosition.inPosition && res.activePosition.entryTime === bm.time;

                let status: 'ACTIVE' | 'HIT_TP' | 'HIT_SL' = 'ACTIVE';
                let exitTime: number | undefined;
                let exitIsoTime: string | undefined;
                let exitPrice: number | undefined;
                let realizedPnlPct: number | undefined;

                if (completedTrade) {
                  status = completedTrade.exitType === 'TP' ? 'HIT_TP' : 'HIT_SL';
                  exitTime = completedTrade.exitTime;
                  exitIsoTime = completedTrade.exitIsoTime;
                  exitPrice = completedTrade.exitPrice;
                  realizedPnlPct = completedTrade.pnlPct;
                } else if (isActive) {
                  status = 'ACTIVE';
                }

                // Check status filter
                if (statusFilter === 'active' && status !== 'ACTIVE') continue;
                if (statusFilter === 'tp' && status !== 'HIT_TP') continue;
                if (statusFilter === 'sl' && status !== 'HIT_SL') continue;

                const entryP = completedTrade ? completedTrade.entryPrice : res.activePosition.entryPrice || res.currentStatus.lastPrice;
                const currP = res.currentStatus.lastPrice;
                const changePct = Number((((currP - entryP) / entryP) * 100).toFixed(2));
                const ageH = Math.max(0, Math.round((latestSec - bm.time) / 3600));

                signals.push({
                  symbol: tok.symbol,
                  baseAsset: tok.baseAsset,
                  quoteAsset: tok.quoteAsset,
                  volumeRank: tok.volumeRank,
                  timeframe: tf,
                  signalTime: bm.time,
                  signalIsoTime: new Date(bm.time * 1000).toISOString(),
                  ageHours: ageH,
                  entryPrice: Number(entryP.toFixed(4)),
                  currentPrice: Number(currP.toFixed(4)),
                  priceChangeSinceEntryPct: changePct,
                  takeProfitPrice: Number((entryP * 1.05).toFixed(4)),
                  stopLossPrice: Number((entryP * 0.95).toFixed(4)),
                  status,
                  exitTime,
                  exitIsoTime,
                  exitPrice: exitPrice ? Number(exitPrice.toFixed(4)) : undefined,
                  realizedPnlPct,
                  isQuantBlue: res.currentStatus.isQuantBlue,
                  quantSma: res.currentStatus.quantSma,
                  ema13: res.currentStatus.ema13,
                  ema21: res.currentStatus.ema21,
                  winRatePct: res.stats.winRatePct,
                  totalPnlPct: res.stats.totalPnlPct,
                  totalTrades: res.stats.totalTrades,
                });
              }
            } catch {
              // Ignore tokens with insufficient candles
            }
          }
        }),
      );
    }

    // Sort by signal time descending (newest first)
    signals.sort((a, b) => b.signalTime - a.signalTime);

    const activeCount = signals.filter((s) => s.status === 'ACTIVE').length;
    const hitTpCount = signals.filter((s) => s.status === 'HIT_TP').length;
    const hitSlCount = signals.filter((s) => s.status === 'HIT_SL').length;

    const result: ScanBuySignalsResult = {
      totalCount: signals.length,
      activeCount,
      hitTpCount,
      hitSlCount,
      cutoffTime: cutoffDate.toISOString(),
      signals,
    };

    this.scanCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  }
}
