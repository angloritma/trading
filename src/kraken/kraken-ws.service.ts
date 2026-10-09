import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as WebSocket from 'ws';
import { Ohlcv } from '../database/entities/ohlcv.entity';
import { KRAKEN_INTERVALS } from './kraken.service';
import { customLookup } from '../common/custom-dns';

export interface LiveKline {
  symbol: string;       // normalized DB symbol e.g. BTCUSD
  timeframe: string;    // '1h' | '4h' | '1d'
  openTime: number;     // Unix ms
  closeTime: number;    // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  isClosed: boolean;
}

@Injectable()
export class KrakenWsService implements OnModuleDestroy {
  private readonly logger = new Logger(KrakenWsService.name);
  private readonly wsUrl: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private subscriptions: Array<{ symbols: string[]; wsnames: string[]; timeframe: string }> = [];
  private isDestroyed = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Ohlcv)
    private readonly ohlcvRepo: Repository<Ohlcv>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.wsUrl = config.get<string>('kraken.wsUrl') || 'wss://ws.kraken.com/v2';
  }

  /**
   * Subscribe to OHLC updates for a list of symbols.
   * @param symbols  - Normalized DB symbols e.g. ["BTCUSD", "ETHUSD"]
   * @param wsnames  - Kraken WS names e.g. ["XBT/USD", "ETH/USD"]
   * @param timeframe - '1h' | '4h' | '1d'
   */
  subscribeKlines(symbols: string[], wsnames: string[], timeframe: string): void {
    this.subscriptions.push({ symbols, wsnames, timeframe });
    this.logger.log(`📡 Subscribing to ${wsnames.length} Kraken OHLC streams (${timeframe})`);
    this.connect();
  }

  private connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Already connected — just send the new subscription
      this.sendSubscriptions();
      return;
    }

    this.ws = new WebSocket(this.wsUrl, { lookup: customLookup } as any);

    this.ws.on('open', () => {
      this.logger.log('Kraken WebSocket v2 connected');
      this.sendSubscriptions();
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch {
        // ignore parse errors
      }
    });

    this.ws.on('error', (err) => {
      this.logger.error(`Kraken WS error: ${err.message}`);
    });

    this.ws.on('close', () => {
      if (this.isDestroyed) return;
      this.logger.warn('Kraken WS closed — reconnecting in 5s…');
      this.ws = null;
      this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
    });
  }

  private sendSubscriptions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const sub of this.subscriptions) {
      const interval = KRAKEN_INTERVALS[sub.timeframe];
      if (!interval) continue;

      const msg = {
        method: 'subscribe',
        params: {
          channel: 'ohlc',
          symbol: sub.wsnames,
          interval,
        },
      };
      this.ws.send(JSON.stringify(msg));
      this.logger.debug(`Sent OHLC subscribe: ${sub.wsnames.length} pairs, interval=${interval}`);
    }
  }

  private handleMessage(msg: any): void {
    // Kraken v2 WS: channel-based event structure
    if (msg.channel !== 'ohlc') return;
    if (msg.type !== 'update' && msg.type !== 'snapshot') return;

    for (const candle of (msg.data ?? [])) {
      this.processCandle(candle);
    }
  }

  private async processCandle(candle: any): Promise<void> {
    try {
      // Find which subscription this symbol belongs to
      let normalizedSymbol = candle.symbol?.replace('XBT', 'BTC').replace('/', '');
      if (!normalizedSymbol) return;

      const intervalMin: number = candle.interval;
      const intervalMs = intervalMin * 60 * 1_000;

      // Map interval back to our timeframe string
      const tf = Object.entries(KRAKEN_INTERVALS).find(([, v]) => v === intervalMin)?.[0];
      if (!tf) return;

      const openTime = new Date(candle.interval_begin).getTime();
      const closeTime = openTime + intervalMs - 1;

      const liveKline: LiveKline = {
        symbol: normalizedSymbol,
        timeframe: tf,
        openTime,
        closeTime,
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume),
        quoteVolume: parseFloat(candle.volume) * parseFloat(candle.close),
        trades: candle.trades ?? 0,
        isClosed: candle.confirm === true,
      };

      // Always emit live update for real-time price display
      this.eventEmitter.emit('kline.update', liveKline);

      // Only persist when candle is confirmed/closed
      if (liveKline.isClosed) {
        await this.persistKline(liveKline);
        this.eventEmitter.emit('kline.closed', liveKline);
      }
    } catch (err) {
      this.logger.error(`Error processing Kraken candle: ${err.message}`);
    }
  }

  private async persistKline(kline: LiveKline): Promise<void> {
    try {
      await this.ohlcvRepo
        .createQueryBuilder()
        .insert()
        .into(Ohlcv)
        .values({
          symbol: kline.symbol,
          timeframe: kline.timeframe,
          openTime: new Date(kline.openTime),
          closeTime: new Date(kline.closeTime),
          open: kline.open,
          high: kline.high,
          low: kline.low,
          close: kline.close,
          volume: kline.volume,
          quoteVolume: kline.quoteVolume,
          trades: kline.trades,
        })
        .orUpdate(
          ['open', 'high', 'low', 'close', 'volume', 'quote_volume', 'trades', 'close_time'],
          ['symbol', 'timeframe', 'open_time'],
        )
        .execute();
    } catch (err) {
      this.logger.error(`Failed to persist kline ${kline.symbol}: ${err.message}`);
    }
  }

  onModuleDestroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.logger.log('Kraken WebSocket connection closed');
  }
}

