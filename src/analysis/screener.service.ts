import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { TaService } from './ta.service';
import { Token } from '../database/entities/token.entity';
import { AnalysisSignal, Recommendation } from '../database/entities/analysis-signal.entity';

export interface ScreenerResult {
  symbol: string;
  baseAsset: string;
  lastPrice: number;
  priceChangePct24h: number;
  volumeRank: number;
  /**
   * Composite swing score — weighted average of 4h (40%) and 1d (60%) TA scores.
   * Range: 0–100
   */
  swingScore: number;
  score1h: number;
  score4h: number;
  score1d: number;
  recommendation: Recommendation;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  indicators4h: Record<string, number | null>;
  indicators1d: Record<string, number | null>;
}

@Injectable()
export class ScreenerService {
  private readonly logger = new Logger(ScreenerService.name);
  private readonly TIMEFRAMES = ['1h', '4h', '1d'];

  constructor(
    private readonly taService: TaService,
    @InjectRepository(Token)
    private readonly tokenRepo: Repository<Token>,
    @InjectRepository(AnalysisSignal)
    private readonly signalRepo: Repository<AnalysisSignal>,
  ) {}

  /**
   * Run full TA analysis for all active tokens across all timeframes.
   * Scheduled every hour.
   */
  @Cron('15 * * * *') // 15 minutes past every hour
  async runScreener(): Promise<void> {
    this.logger.log('🔍 Running screener analysis…');
    const tokens = await this.tokenRepo.find({ where: { isActive: true } });

    let processed = 0;
    for (const token of tokens) {
      for (const tf of this.TIMEFRAMES) {
        try {
          const result = await this.taService.analyseSymbol(token.symbol, tf);
          if (result) {
            await this.taService.saveSignal(result);
            processed++;
          }
        } catch (err) {
          this.logger.warn(`Screener failed ${token.symbol}/${tf}: ${err.message}`);
        }
      }
    }

    this.logger.log(`✅ Screener complete: ${processed} signals generated`);
  }

  /**
   * Get ranked screener results from the latest saved signals.
   */
  async getScreenerResults(
    limit = 50,
    minScore = 0,
    recommendation?: Recommendation,
  ): Promise<ScreenerResult[]> {
    const tokens = await this.tokenRepo.find({
      where: { isActive: true },
      order: { volumeRank: 'ASC' },
    });

    const results: ScreenerResult[] = [];

    for (const token of tokens) {
      const signals: Record<string, AnalysisSignal | null> = {};

      for (const tf of this.TIMEFRAMES) {
        signals[tf] = await this.taService.getLatestSignal(token.symbol, tf);
      }

      if (!signals['4h'] && !signals['1d']) continue;

      const score4h = signals['4h']?.taScore ?? 0;
      const score1d = signals['1d']?.taScore ?? 0;
      const score1h = signals['1h']?.taScore ?? 0;

      // Swing composite: 4h has 40% weight, 1d has 60% weight
      const swingScore = Math.round(score4h * 0.4 + score1d * 0.6);

      if (swingScore < minScore) continue;

      // Derive recommendation from composite swing score
      const rec =
        swingScore >= 70
          ? Recommendation.BUY
          : swingScore >= 55
            ? Recommendation.WATCH
            : swingScore >= 40
              ? Recommendation.NEUTRAL
              : Recommendation.AVOID;

      if (recommendation && rec !== recommendation) continue;

      results.push({
        symbol: token.symbol,
        baseAsset: token.baseAsset,
        lastPrice: Number(token.lastPrice),
        priceChangePct24h: Number(token.priceChangePct24h),
        volumeRank: token.volumeRank,
        swingScore,
        score1h,
        score4h,
        score1d,
        recommendation: rec,
        trendScore: signals['4h']?.trendScore ?? 0,
        momentumScore: signals['4h']?.momentumScore ?? 0,
        volumeScore: signals['4h']?.volumeScore ?? 0,
        indicators4h: (signals['4h']?.indicators as Record<string, number | null>) ?? {},
        indicators1d: (signals['1d']?.indicators as Record<string, number | null>) ?? {},
      });
    }

    // Sort by swing score descending
    results.sort((a, b) => b.swingScore - a.swingScore);

    return results.slice(0, limit);
  }
}
