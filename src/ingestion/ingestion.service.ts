import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { KrakenService, INTERVAL_MS } from '../kraken/kraken.service';
import { KrakenWsService } from '../kraken/kraken-ws.service';
import { Token } from '../database/entities/token.entity';
import { Ohlcv } from '../database/entities/ohlcv.entity';

interface ActiveSymbol {
  /** Normalized DB symbol e.g. BTCUSD */
  symbol: string;
  /** Kraken altname for REST calls e.g. XBTUSD */
  altname: string;
  /** Kraken WS name e.g. XBT/USD */
  wsname: string;
}

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);
  private activeSymbols: ActiveSymbol[] = [];

  private readonly topN: number;
  private readonly backfillDays: number;
  private readonly timeframes: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly kraken: KrakenService,
    private readonly krakenWs: KrakenWsService,
    @InjectRepository(Token) private readonly tokenRepo: Repository<Token>,
    @InjectRepository(Ohlcv) private readonly ohlcvRepo: Repository<Ohlcv>,
  ) {
    this.topN = config.get<number>('ingestion.topTokensCount') ?? 100;
    this.backfillDays = config.get<number>('ingestion.backfillDays') ?? 90;
    this.timeframes = ['1h', '4h', '1d'];
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('🚀 Ingestion service starting…');
    await this.refreshTokenList();
    // Run back-fill and WS in background so HTTP server is available immediately
    this.backfillAll()
      .then(() => {
        this.startWebSocketStreams();
        this.logger.log('✅ Ingestion service ready');
      })
      .catch((err) => {
        this.logger.error(`Initial backfill error: ${err.message}`);
      });
  }

  // ─── Scheduled Jobs ──────────────────────────────────────────────────────────

  /** Refresh top-100 token list every 1 hour */
  @Cron(CronExpression.EVERY_HOUR)
  async refreshTokenList(): Promise<void> {
    try {
      this.logger.log('🔄 Refreshing top token list from Kraken…');
      const tickers = await this.kraken.getTop24hTickers(this.topN);

      let rank = 1;
      const newActive: ActiveSymbol[] = [];

      for (const ticker of tickers) {
        await this.tokenRepo.upsert(
          {
            symbol: ticker.symbol,
            baseAsset: ticker.baseAsset,
            quoteAsset: ticker.quoteAsset,
            volumeRank: rank++,
            quoteVolume24h: ticker.quoteVolume24h,
            priceChangePct24h: ticker.priceChangePct24h,
            lastPrice: ticker.lastPrice,
            isActive: true,
          },
          ['symbol'],
        );

        newActive.push({
          symbol: ticker.symbol,
          altname: ticker.krakenAltname,
          wsname: ticker.krakenWsname,
        });
      }

      this.activeSymbols = newActive;
      this.logger.log(`✅ Token list refreshed: ${newActive.length} active Kraken pairs`);
    } catch (err) {
      this.logger.error(`Token list refresh failed: ${err.message}`);
    }
  }

  /** Incremental OHLCV update every hour */
  @Cron('0 * * * *')
  async incrementalUpdate(): Promise<void> {
    if (!this.activeSymbols.length) return;
    this.logger.log(`🔄 Incremental update for ${this.activeSymbols.length} symbols…`);

    const endTimeSec = Math.floor(Date.now() / 1_000);

    for (const sym of this.activeSymbols) {
      for (const tf of this.timeframes) {
        try {
          // Fetch last 5 candles to ensure no gap
          const lookbackSec = 5 * (INTERVAL_MS[tf] / 1_000);
          const startTimeSec = endTimeSec - lookbackSec;
          await this.fetchAndStoreKlines(sym, tf, startTimeSec, endTimeSec);
        } catch (err) {
          this.logger.warn(`Incremental update failed ${sym.symbol}/${tf}: ${err.message}`);
        }
      }
    }

    this.logger.log('✅ Incremental update complete');
  }

  // ─── Back-fill ────────────────────────────────────────────────────────────────

  private async backfillAll(): Promise<void> {
    // Use tokenRepo to get all active tokens (may include seed data)
    const tokens = await this.tokenRepo.find({ where: { isActive: true } });
    if (!tokens.length) {
      this.logger.warn('No active tokens found — skipping back-fill');
      return;
    }

    // Build the active symbol list from DB if it's empty (e.g. seed data exists)
    if (!this.activeSymbols.length) {
      // Map token symbols back to Kraken altnames
      const pairs = await this.kraken.getUsdPairs().catch(() => new Map());
      const pairsBySymbol = new Map<string, { altname: string; wsname: string }>();
      for (const [altname, pair] of pairs.entries()) {
        pairsBySymbol.set(pair.symbol, { altname, wsname: pair.wsname });
      }

      for (const token of tokens) {
        const meta = pairsBySymbol.get(token.symbol);
        if (meta) {
          this.activeSymbols.push({
            symbol: token.symbol,
            altname: meta.altname,
            wsname: meta.wsname,
          });
        }
      }
    }

    if (!this.activeSymbols.length) {
      this.logger.warn('Could not map tokens to Kraken pairs — skipping back-fill');
      return;
    }

    const endTimeSec = Math.floor(Date.now() / 1_000);
    const startTimeSec = endTimeSec - this.backfillDays * 24 * 60 * 60;

    this.logger.log(
      `📥 Back-filling ${this.activeSymbols.length} tokens × ${this.timeframes.length} timeframes (${this.backfillDays} days)…`,
    );

    for (const sym of this.activeSymbols) {
      for (const tf of this.timeframes) {
        const latest = await this.ohlcvRepo.findOne({
          where: { symbol: sym.symbol, timeframe: tf },
          order: { openTime: 'DESC' },
        });

        const oldest = await this.ohlcvRepo.findOne({
          where: { symbol: sym.symbol, timeframe: tf },
          order: { openTime: 'ASC' },
        });

        let tfStartTimeSec = startTimeSec;
        if (tf === '1d') {
          tfStartTimeSec = endTimeSec - 720 * 24 * 60 * 60;
        }

        const intervalSec = INTERVAL_MS[tf] / 1_000;
        
        let from = tfStartTimeSec;
        if (latest && oldest) {
           const oldestTimeSec = Math.floor(oldest.openTime.getTime() / 1_000);
           // Overlap by 5 candles to overwrite any recent incomplete candles that might have been skipped
           if (oldestTimeSec <= tfStartTimeSec + intervalSec) {
             from = Math.floor(latest.openTime.getTime() / 1_000) - 5 * intervalSec;
           }
        }

        if (from >= endTimeSec) {
          this.logger.debug(`${sym.symbol}/${tf} up to date, skipping`);
          continue;
        }

        try {
          const count = await this.fetchAndStoreKlines(sym, tf, from, endTimeSec);
          this.logger.debug(`${sym.symbol}/${tf}: stored ${count} candles`);
        } catch (err) {
          this.logger.warn(`Back-fill failed ${sym.symbol}/${tf}: ${err.message}`);
        }

        // Brief pause between requests
        await this.sleep(300);
      }
    }

    this.logger.log('✅ Historical back-fill complete');
  }

  private async fetchAndStoreKlines(
    sym: ActiveSymbol,
    timeframe: string,
    startTimeSec: number,
    endTimeSec: number,
  ): Promise<number> {
    const candles = await this.kraken.getOhlcv(sym.altname, timeframe, startTimeSec, endTimeSec);
    if (!candles.length) return 0;

    const rows = candles.map((k) => ({
      symbol: sym.symbol,
      timeframe,
      openTime: new Date(k.openTime * 1_000),   // Kraken returns seconds → convert to ms
      closeTime: new Date(k.closeTime * 1_000),
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
      quoteVolume: parseFloat(k.quoteVolume),
      trades: k.trades,
    }));

    // Deduplicate rows based on openTime to prevent "ON CONFLICT DO UPDATE command cannot affect row a second time"
    // (Kraken occasionally returns duplicate live candles with the same openTime)
    const uniqueRowsMap = new Map();
    for (const row of rows) {
      uniqueRowsMap.set(row.openTime.getTime(), row);
    }
    const uniqueRows = Array.from(uniqueRowsMap.values());

    // Batch upsert in chunks of 500 to avoid PG parameter limit
    const chunkSize = 500;
    for (let i = 0; i < uniqueRows.length; i += chunkSize) {
      await this.ohlcvRepo
        .createQueryBuilder()
        .insert()
        .into(Ohlcv)
        .values(uniqueRows.slice(i, i + chunkSize))
        .orUpdate(
          ['close_time', 'open', 'high', 'low', 'close', 'volume', 'quote_volume', 'trades'],
          ['symbol', 'timeframe', 'open_time']
        )
        .execute();
    }

    return rows.length;
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────────

  private startWebSocketStreams(): void {
    if (!this.activeSymbols.length) {
      this.logger.warn('No active symbols for WebSocket streaming');
      return;
    }

    const symbols = this.activeSymbols.map((s) => s.symbol);
    const wsnames = this.activeSymbols.map((s) => s.wsname);

    // Subscribe to real-time 1h candles for swing monitoring
    this.krakenWs.subscribeKlines(symbols, wsnames, '1h');
    this.logger.log(`📡 Kraken WebSocket streaming started for ${symbols.length} pairs`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
