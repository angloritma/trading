import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum Recommendation {
  BUY = 'BUY',
  WATCH = 'WATCH',
  NEUTRAL = 'NEUTRAL',
  AVOID = 'AVOID',
}

@Entity('analysis_signals')
@Index(['symbol', 'timeframe', 'analyzedAt'])
export class AnalysisSignal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Column({ type: 'varchar', length: 5 })
  timeframe: string;

  @CreateDateColumn({ name: 'analyzed_at' })
  analyzedAt: Date;

  /** Composite swing score 0-100 */
  @Column({ name: 'ta_score', type: 'int' })
  taScore: number;

  @Column({ name: 'trend_score', type: 'int' })
  trendScore: number;

  @Column({ name: 'momentum_score', type: 'int' })
  momentumScore: number;

  @Column({ name: 'volume_score', type: 'int' })
  volumeScore: number;

  @Column({
    type: 'enum',
    enum: Recommendation,
    default: Recommendation.NEUTRAL,
  })
  recommendation: Recommendation;

  /**
   * Full indicator snapshot stored as JSONB.
   * Example keys: rsi, macd, macdSignal, macdHist,
   * ema20, ema50, ema200, bbUpper, bbMiddle, bbLower,
   * atr, obv, stochK, stochD, adx
   */
  @Column({ type: 'jsonb', default: {} })
  indicators: Record<string, number | null>;
}
