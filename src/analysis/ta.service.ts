import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RSI,
  MACD,
  EMA,
  BollingerBands,
  ATR,
  OBV,
  Stochastic,
  ADX,
} from 'technicalindicators';
import { Ohlcv } from '../database/entities/ohlcv.entity';
import {
  AnalysisSignal,
  Recommendation,
} from '../database/entities/analysis-signal.entity';

export interface TaIndicators {
  [key: string]: number | null;
  // Trend
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  adx: number | null;
  // Momentum
  rsi: number | null;
  stochK: number | null;
  stochD: number | null;
  // Volatility
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  atr: number | null;
  // Volume
  obv: number | null;
  volumeRatio: number | null; // current vol / 20-bar avg vol
  // Price
  close: number | null;
}

export interface TaResult {
  symbol: string;
  timeframe: string;
  indicators: TaIndicators;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  taScore: number;
  recommendation: Recommendation;
}

@Injectable()
export class TaService {
  private readonly logger = new Logger(TaService.name);

  constructor(
    @InjectRepository(Ohlcv)
    private readonly ohlcvRepo: Repository<Ohlcv>,
    @InjectRepository(AnalysisSignal)
    private readonly signalRepo: Repository<AnalysisSignal>,
  ) {}

  /**
   * Run full TA for a symbol/timeframe pair.
   * Fetches the last 250 candles (enough for EMA200).
   */
  async analyseSymbol(symbol: string, timeframe: string): Promise<TaResult | null> {
    const rows = await this.ohlcvRepo.find({
      where: { symbol, timeframe },
      order: { openTime: 'DESC' },
      take: 250,
    });
    const candles = rows.reverse();

    if (candles.length < 50) {
      this.logger.debug(`Not enough candles for ${symbol}/${timeframe} (${candles.length})`);
      return null;
    }

    const closes = candles.map((c) => Number(c.close));
    const highs = candles.map((c) => Number(c.high));
    const lows = candles.map((c) => Number(c.low));
    const volumes = candles.map((c) => Number(c.volume));
    const lastClose = closes[closes.length - 1];

    // ── Indicators ─────────────────────────────────────────────────────────────

    const ema20Vals = EMA.calculate({ period: 20, values: closes });
    const ema50Vals = EMA.calculate({ period: 50, values: closes });
    const ema200Vals = EMA.calculate({ period: 200, values: closes });

    const macdVals = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const rsiVals = RSI.calculate({ period: 14, values: closes });

    const stochVals = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });

    const bbVals = BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2,
    });

    const atrVals = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });

    const obvVals = OBV.calculate({ close: closes, volume: volumes });

    const adxVals = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

    // ── Last values ─────────────────────────────────────────────────────────────
    const last = <T>(arr: T[]): T | null => (arr.length ? arr[arr.length - 1] : null);

    const ema20 = last(ema20Vals) ?? null;
    const ema50 = last(ema50Vals) ?? null;
    const ema200 = last(ema200Vals) ?? null;
    const macdResult = last(macdVals);
    const rsi = last(rsiVals) ?? null;
    const stoch = last(stochVals);
    const bb = last(bbVals);
    const atr = last(atrVals) ?? null;
    const obv = last(obvVals) ?? null;
    const adxResult = last(adxVals);

    // Volume ratio: current / 20-bar average
    const vol20Avg =
      volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(volumes.length, 20);
    const volumeRatio = vol20Avg > 0 ? volumes[volumes.length - 1] / vol20Avg : null;

    const indicators: TaIndicators = {
      ema20,
      ema50,
      ema200,
      macd: macdResult?.MACD ?? null,
      macdSignal: macdResult?.signal ?? null,
      macdHist: macdResult?.histogram ?? null,
      adx: adxResult?.adx ?? null,
      rsi,
      stochK: stoch?.k ?? null,
      stochD: stoch?.d ?? null,
      bbUpper: bb?.upper ?? null,
      bbMiddle: bb?.middle ?? null,
      bbLower: bb?.lower ?? null,
      bbWidth: bb ? ((bb.upper - bb.lower) / bb.middle) * 100 : null,
      atr,
      obv,
      volumeRatio,
      close: lastClose,
    };

    // ── Scoring ─────────────────────────────────────────────────────────────────
    const trendScore = this.scoreTrend(indicators);
    const momentumScore = this.scoreMomentum(indicators);
    const volumeScore = this.scoreVolume(indicators);

    // Swing trading weights: trend 40%, momentum 35%, volume 25%
    const taScore = Math.round(trendScore * 0.4 + momentumScore * 0.35 + volumeScore * 0.25);
    const recommendation = this.toRecommendation(taScore);

    return { symbol, timeframe, indicators, trendScore, momentumScore, volumeScore, taScore, recommendation };
  }

  // ─── Scoring helpers ─────────────────────────────────────────────────────────

  private scoreTrend(ind: TaIndicators): number {
    let score = 50; // neutral baseline
    const { close, ema20, ema50, ema200, macdHist, adx } = ind;

    // Price vs EMA alignment
    if (close !== null && ema20 && close > ema20) score += 8;
    if (close !== null && ema20 && close < ema20) score -= 8;
    if (close !== null && ema50 && close > ema50) score += 8;
    if (close !== null && ema50 && close < ema50) score -= 8;
    if (close !== null && ema200 && close > ema200) score += 10;
    if (close !== null && ema200 && close < ema200) score -= 10;

    // EMA stacking (bullish: ema20 > ema50 > ema200)
    if (ema20 && ema50 && ema200) {
      if (ema20 > ema50 && ema50 > ema200) score += 12;
      else if (ema20 < ema50 && ema50 < ema200) score -= 12;
    }

    // MACD histogram direction
    if (macdHist !== null) {
      if (macdHist > 0) score += 8;
      else score -= 8;
    }

    // ADX strength (trend strength > 25 is meaningful)
    if (adx !== null) {
      if (adx > 40) score += 6;
      else if (adx > 25) score += 3;
      else score -= 3; // weak trend = range-bound
    }

    return Math.max(0, Math.min(100, score));
  }

  private scoreMomentum(ind: TaIndicators): number {
    let score = 50;
    const { rsi, stochK, stochD, macd, macdSignal } = ind;

    // RSI zones
    if (rsi !== null) {
      if (rsi >= 55 && rsi <= 70) score += 15; // bullish momentum
      else if (rsi > 70) score += 5; // overbought — caution
      else if (rsi >= 40 && rsi < 55) score -= 5; // weak momentum
      else if (rsi >= 30 && rsi < 40) score -= 10; // oversold bounce potential
      else if (rsi < 30) score -= 20; // strong downtrend
    }

    // Stochastic
    if (stochK !== null && stochD !== null) {
      if (stochK > stochD && stochK < 80) score += 10; // bullish crossover below overbought
      else if (stochK < stochD && stochK > 20) score -= 10;
      else if (stochK < 20) score -= 8; // oversold
      else if (stochK > 80) score += 3; // overbought, slight positive
    }

    // MACD line vs signal
    if (macd !== null && macdSignal !== null) {
      if (macd > macdSignal) score += 10;
      else score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  private scoreVolume(ind: TaIndicators): number {
    let score = 50;
    const { volumeRatio, close, bbUpper, bbLower, bbMiddle } = ind;

    // Volume expansion
    if (volumeRatio !== null) {
      if (volumeRatio > 2.0) score += 20; // strong volume surge
      else if (volumeRatio > 1.5) score += 12;
      else if (volumeRatio > 1.0) score += 5;
      else if (volumeRatio < 0.5) score -= 15; // drying up volume
    }

    // Bollinger Band position
    if (close !== null && bbUpper && bbLower && bbMiddle) {
      const range = bbUpper - bbLower;
      const pos = (close - bbLower) / range; // 0 = at lower, 1 = at upper
      if (pos > 0.7 && pos <= 1.0) score += 10; // upper half — bullish
      else if (pos < 0.3) score -= 10; // lower half — bearish
    }

    return Math.max(0, Math.min(100, score));
  }

  private toRecommendation(score: number): Recommendation {
    if (score >= 70) return Recommendation.BUY;
    if (score >= 55) return Recommendation.WATCH;
    if (score >= 40) return Recommendation.NEUTRAL;
    return Recommendation.AVOID;
  }

  /**
   * Persist the analysis result to the database.
   */
  async saveSignal(result: TaResult): Promise<AnalysisSignal> {
    const signal = this.signalRepo.create({
      symbol: result.symbol,
      timeframe: result.timeframe,
      taScore: result.taScore,
      trendScore: result.trendScore,
      momentumScore: result.momentumScore,
      volumeScore: result.volumeScore,
      recommendation: result.recommendation,
      indicators: result.indicators as Record<string, number | null>,
    });
    return this.signalRepo.save(signal);
  }

  /**
   * Get the latest signal for a symbol/timeframe.
   */
  async getLatestSignal(symbol: string, timeframe: string): Promise<AnalysisSignal | null> {
    return this.signalRepo.findOne({
      where: { symbol, timeframe },
      order: { analyzedAt: 'DESC' },
    });
  }
}
