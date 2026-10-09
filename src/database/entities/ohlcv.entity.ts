import { Entity, Column, Index, PrimaryColumn } from 'typeorm';

/**
 * OHLCV candlestick data.
 * After creation, this table is converted to a TimescaleDB hypertable
 * partitioned on `open_time` for high-performance time-series queries.
 *
 * Composite primary key: (symbol, timeframe, open_time)
 * TimescaleDB requires the partition column to be part of the PK.
 */
@Entity('ohlcv')
@Index(['symbol', 'timeframe'])
export class Ohlcv {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  symbol: string;

  @PrimaryColumn({ type: 'varchar', length: 5 })
  timeframe: string;

  @PrimaryColumn({ name: 'open_time', type: 'timestamptz' })
  openTime: Date;

  @Column({ name: 'close_time', type: 'timestamptz' })
  closeTime: Date;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  open: number;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  high: number;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  low: number;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  close: number;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  volume: number;

  @Column({ name: 'quote_volume', type: 'numeric', precision: 30, scale: 8 })
  quoteVolume: number;

  @Column({ type: 'int', default: 0 })
  trades: number;
}
