import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('ai_recommendations')
export class AiRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** Symbols the agent analysed in this recommendation */
  @Column({ type: 'varchar', array: true, default: [] })
  symbols: string[];

  /** Full markdown reasoning from the AI agent */
  @Column({ type: 'text' })
  reasoning: string;

  /** Structured picks: [{ symbol, action, entry, target, stop, rationale }] */
  @Column({ type: 'jsonb', default: [] })
  picks: Array<{
    symbol: string;
    action: 'BUY' | 'WATCH' | 'AVOID';
    entry?: number;
    target?: number;
    stop?: number;
    rationale: string;
  }>;

  @Column({ type: 'int', default: 0 })
  confidence: number;

  /** Optional: chat session that triggered this recommendation */
  @Column({ name: 'session_id', type: 'varchar', nullable: true })
  sessionId: string | null;
}
