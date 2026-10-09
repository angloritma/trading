import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tokens')
export class Token {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  symbol: string; // e.g. BTCUSDT

  @Column({ name: 'base_asset', type: 'varchar', length: 10 })
  baseAsset: string; // e.g. BTC

  @Column({ name: 'quote_asset', type: 'varchar', length: 10 })
  quoteAsset: string; // e.g. USDT

  @Column({ name: 'volume_rank', type: 'int', nullable: true })
  volumeRank: number; // 1-100

  @Column({ name: 'quote_volume_24h', type: 'numeric', precision: 30, scale: 8, nullable: true })
  quoteVolume24h: number;

  @Column({ name: 'price_change_pct_24h', type: 'numeric', precision: 10, scale: 4, nullable: true })
  priceChangePct24h: number;

  @Column({ name: 'last_price', type: 'numeric', precision: 30, scale: 8, nullable: true })
  lastPrice: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
