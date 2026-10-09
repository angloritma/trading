import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { customLookup } from '../common/custom-dns';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface KrakenTicker {
  /** Normalized symbol stored in DB e.g. BTCUSD */
  symbol: string;
  /** Kraken altname e.g. XBTUSD */
  krakenAltname: string;
  /** Kraken wsname e.g. XBT/USD — used for WS subscriptions */
  krakenWsname: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number;
  priceChangePct24h: number;
  /** 24h USD quote volume */
  quoteVolume24h: number;
  volume24h: number;
}

export interface KrakenOhlcvCandle {
  openTime: number;   // Unix seconds
  closeTime: number;  // openTime + intervalSec - 1
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: number;
}

export interface KrakenAssetPair {
  key: string;          // Kraken internal key: XXBTZUSD (used in Ticker/OHLC responses)
  symbol: string;       // normalized: BTCUSD
  altname: string;      // Kraken: XBTUSD
  wsname: string;       // Kraken WS: XBT/USD
  baseAsset: string;    // BTC
  quoteAsset: string;   // USD
}

// ─── Timeframe mapping ─────────────────────────────────────────────────────────

/** Map our standard timeframe strings to Kraken interval minutes */
export const KRAKEN_INTERVALS: Record<string, number> = {
  '1h':  60,
  '4h':  240,
  '1d':  1440,
};

/** Interval minutes → ms per candle */
export const INTERVAL_MS: Record<string, number> = {
  '1h':  60 * 60 * 1_000,
  '4h':  4 * 60 * 60 * 1_000,
  '1d':  24 * 60 * 60 * 1_000,
};

@Injectable()
export class KrakenService implements OnModuleInit {
  private readonly logger = new Logger(KrakenService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  /** Cache of USD pairs from AssetPairs, keyed by altname */
  private pairsCache: Map<string, KrakenAssetPair> = new Map();
  private pairsCacheTs = 0;
  private readonly CACHE_TTL = 60 * 60 * 1_000; // 1h

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get<string>('kraken.apiKey') || '';
    const baseUrl = config.get<string>('kraken.baseUrl') || 'https://api.kraken.com';

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 30_000,
      // Resolve via public DNS to bypass ISP DNS hijacking; TLS verification stays ON
      httpsAgent: new https.Agent({ keepAlive: true, lookup: customLookup }),
      headers: {
        'API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  onModuleInit() {
    this.logger.log('KrakenService initialised');
  }

  // ─── Public helpers ───────────────────────────────────────────────────────────

  /** Kraken legacy asset codes → common tickers */
  private static readonly ASSET_ALIASES: Record<string, string> = {
    XBT: 'BTC',
    XDG: 'DOGE',
  };

  /** Normalize a Kraken base asset code (from wsname) to a common ticker. */
  normalizeAsset(code: string): string {
    return KrakenService.ASSET_ALIASES[code] ?? code;
  }

  /**
   * Build our DB symbol from a Kraken wsname.
   * e.g. "XBT/USD" → "BTCUSD", "XRP/USD" → "XRPUSD", "XDG/USD" → "DOGEUSD"
   */
  symbolFromWsname(wsname: string): string {
    const [base, quote] = wsname.split('/');
    return `${this.normalizeAsset(base)}${quote}`;
  }

  // ─── Asset pairs ──────────────────────────────────────────────────────────────

  /**
   * Fetch and cache all tradeable USD spot pairs from Kraken.
   * Returns a map keyed by altname (e.g. "XBTUSD").
   */
  async getUsdPairs(): Promise<Map<string, KrakenAssetPair>> {
    if (Date.now() - this.pairsCacheTs < this.CACHE_TTL && this.pairsCache.size > 0) {
      return this.pairsCache;
    }

    const res = await this.http.get('/0/public/AssetPairs');
    this.assertNoError(res.data);

    const map = new Map<string, KrakenAssetPair>();

    for (const [key, pair] of Object.entries<any>(res.data.result)) {
      // Only online spot pairs quoted in USD with a wsname
      if (
        pair.status !== 'online' ||
        !['USD', 'ZUSD'].includes(pair.quote) ||
        !pair.wsname ||
        pair.altname?.endsWith('.d') // no darkpool pairs
      ) continue;

      const wsname: string = pair.wsname; // e.g. XBT/USD
      const baseAsset = this.normalizeAsset(wsname.split('/')[0]);

      // Skip stablecoin/fiat bases (USDT/USD, EUR/USD, ...) — not swing candidates
      if (KrakenService.EXCLUDED_BASES.has(baseAsset)) continue;

      map.set(pair.altname, {
        key,
        symbol: this.symbolFromWsname(wsname),
        altname: pair.altname,
        wsname,
        baseAsset,
        quoteAsset: 'USD',
      });
    }

    this.pairsCache = map;
    this.pairsCacheTs = Date.now();
    this.logger.log(`Loaded ${map.size} USD spot pairs from Kraken`);
    return map;
  }

  async getPairBySymbol(symbol: string): Promise<KrakenAssetPair | undefined> {
    const pairs = await this.getUsdPairs();
    for (const pair of pairs.values()) {
      if (pair.symbol === symbol) return pair;
    }
    return undefined;
  }

  /** Stablecoins & fiat that should not appear in the screener */
  private static readonly EXCLUDED_BASES = new Set([
    'USDT', 'USDC', 'DAI', 'PYUSD', 'USDG', 'RLUSD', 'TUSD', 'USDD', 'USDE', 'FDUSD', 'EURC', 'USDS',
    'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'JPY',
  ]);

  // ─── 24h tickers ─────────────────────────────────────────────────────────────

  /**
   * Fetch 24h ticker data for all USD pairs and return top-N by USD volume.
   * Used as a market-cap proxy (same approach as Binance quoteVolume sort).
   */
  async getTop24hTickers(topN: number): Promise<KrakenTicker[]> {
    const pairs = await this.getUsdPairs();
    const altnameList = Array.from(pairs.keys());

    // Kraken accepts comma-separated pairs; batch in groups of 50 to stay within URL limit
    const results: KrakenTicker[] = [];
    const batchSize = 50;

    for (let i = 0; i < altnameList.length; i += batchSize) {
      const batch = altnameList.slice(i, i + batchSize);
      try {
        const res = await this.http.get('/0/public/Ticker', {
          params: { pair: batch.join(',') },
        });
        this.assertNoError(res.data);

        for (const [krakenKey, data] of Object.entries<any>(res.data.result)) {
          // Kraken returns internal keys like XXBTZUSD; find our altname
          const pair = this.findPairByKrakenKey(krakenKey, pairs);
          if (!pair) continue;

          const lastPrice = parseFloat(data.c[0]);
          const volume24h = parseFloat(data.v[1]);     // v[1] = rolling 24h
          const vwap24h = parseFloat(data.p[1]);       // VWAP 24h
          const open = parseFloat(data.o);
          const priceChangePct24h = open > 0
            ? ((lastPrice - open) / open) * 100
            : 0;

          results.push({
            symbol: pair.symbol,
            krakenAltname: pair.altname,
            krakenWsname: pair.wsname,
            baseAsset: pair.baseAsset,
            quoteAsset: 'USD',
            lastPrice,
            priceChangePct24h,
            quoteVolume24h: volume24h * vwap24h,
            volume24h,
          });
        }
      } catch (err) {
        this.logger.warn(`Ticker batch failed: ${err.message}`);
      }

      await this.sleep(200); // be polite to the API
    }

    // Sort by 24h USD quote volume descending
    results.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
    return results.slice(0, topN);
  }

  // ─── OHLCV ───────────────────────────────────────────────────────────────────

  /**
   * Fetch OHLCV candles for a pair.
   * Kraken returns max 720 candles per call. We paginate using the `last` cursor.
   *
   * @param altname  - Kraken altname, e.g. "XBTUSD"
   * @param timeframe - Our timeframe string: '1h' | '4h' | '1d'
   * @param startTimeSec - Unix seconds (Kraken uses seconds, NOT ms)
   * @param endTimeSec   - Unix seconds
   */
  async getOhlcv(
    altname: string,
    timeframe: string,
    startTimeSec: number,
    endTimeSec: number,
  ): Promise<KrakenOhlcvCandle[]> {
    const interval = KRAKEN_INTERVALS[timeframe];
    if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);

    const intervalSec = interval * 60;
    const results: KrakenOhlcvCandle[] = [];
    let since = startTimeSec;

    while (since < endTimeSec) {
      const res = await this.http.get('/0/public/OHLC', {
        params: { pair: altname, interval, since },
      });
      this.assertNoError(res.data);

      // Kraken returns the result under the internal pair key, not altname
      const resultKey = Object.keys(res.data.result).find((k) => k !== 'last');
      if (!resultKey) break;

      const rows: any[][] = res.data.result[resultKey];
      if (!rows?.length) break;

      for (const row of rows) {
        const openTimeSec = row[0];
        // Skip candles beyond our requested range
        if (openTimeSec >= endTimeSec) break;

        results.push({
          openTime: openTimeSec,
          closeTime: openTimeSec + intervalSec - 1,
          open: row[1],
          high: row[2],
          low: row[3],
          close: row[4],
          volume: row[6],        // row[5] = VWAP, row[6] = volume
          quoteVolume: String(parseFloat(row[6]) * parseFloat(row[4])), // volume × close ≈ quoteVolume
          trades: row[7],
        });
      }

      const lastCursor: number = res.data.result.last;
      if (!lastCursor || lastCursor <= since) break;
      since = lastCursor;

      if (rows.length < 720) break; // last page

      await this.sleep(300); // Kraken rate limit buffer
    }

    return results;
  }

  /**
   * Get the current price for a single pair.
   * @param altname - Kraken altname e.g. "XBTUSD"
   */
  async getCurrentPrice(altname: string): Promise<number> {
    const res = await this.http.get('/0/public/Ticker', {
      params: { pair: altname },
    });
    this.assertNoError(res.data);
    const key = Object.keys(res.data.result)[0];
    return parseFloat(res.data.result[key].c[0]);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────────

  /**
   * Kraken returns ticker results keyed by internal name (e.g. XXBTZUSD),
   * which matches the AssetPairs result key. Fall back to altname.
   */
  private findPairByKrakenKey(
    krakenKey: string,
    pairs: Map<string, KrakenAssetPair>,
  ): KrakenAssetPair | undefined {
    for (const pair of pairs.values()) {
      if (pair.key === krakenKey) return pair;
    }
    return pairs.get(krakenKey);
  }

  private assertNoError(data: any): void {
    if (data.error?.length) {
      throw new Error(`Kraken API error: ${data.error.join(', ')}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

