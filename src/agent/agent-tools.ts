import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScreenerService } from '../analysis/screener.service';
import { TaService } from '../analysis/ta.service';
import { Ohlcv } from '../database/entities/ohlcv.entity';
import { Token } from '../database/entities/token.entity';
import { AnalysisSignal } from '../database/entities/analysis-signal.entity';

// ─── Tool return types ────────────────────────────────────────────────────────

export interface TopTokensResult {
  tokens: Array<{
    symbol: string;
    swingScore: number;
    recommendation: string;
    lastPrice: number;
    priceChangePct24h: number;
    trendScore: number;
    momentumScore: number;
    volumeScore: number;
  }>;
}

export interface TechnicalSignalResult {
  symbol: string;
  timeframe: string;
  taScore: number;
  recommendation: string;
  indicators: Record<string, number | null>;
  analyzedAt: string | null;
}

export interface PriceHistoryResult {
  symbol: string;
  timeframe: string;
  candles: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export interface MarketOverviewResult {
  topGainers: Array<{ symbol: string; changePct: number; price: number }>;
  topLosers: Array<{ symbol: string; changePct: number; price: number }>;
  topBySwingScore: Array<{ symbol: string; swingScore: number; recommendation: string }>;
  marketSummary: string;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

@Injectable()
export class AgentTools {
  private readonly logger = new Logger(AgentTools.name);

  constructor(
    private readonly screener: ScreenerService,
    private readonly taService: TaService,
    @InjectRepository(Ohlcv) private readonly ohlcvRepo: Repository<Ohlcv>,
    @InjectRepository(Token) private readonly tokenRepo: Repository<Token>,
    @InjectRepository(AnalysisSignal) private readonly signalRepo: Repository<AnalysisSignal>,
  ) {}

  /** Get top-N tokens ranked by swing score */
  async getTopTokens(limit = 10, minScore = 0): Promise<TopTokensResult> {
    const results = await this.screener.getScreenerResults(limit, minScore);
    return {
      tokens: results.map((r) => ({
        symbol: r.symbol,
        swingScore: r.swingScore,
        recommendation: r.recommendation,
        lastPrice: r.lastPrice,
        priceChangePct24h: r.priceChangePct24h,
        trendScore: r.trendScore,
        momentumScore: r.momentumScore,
        volumeScore: r.volumeScore,
      })),
    };
  }

  /** Get detailed TA signal for a specific symbol/timeframe */
  async getTechnicalSignal(
    symbol: string,
    timeframe: '1h' | '4h' | '1d',
  ): Promise<TechnicalSignalResult> {
    const signal = await this.taService.getLatestSignal(symbol.toUpperCase(), timeframe);

    if (!signal) {
      // Run fresh analysis if no saved signal exists
      const fresh = await this.taService.analyseSymbol(symbol.toUpperCase(), timeframe);
      if (!fresh) {
        return {
          symbol,
          timeframe,
          taScore: 0,
          recommendation: 'NO_DATA',
          indicators: {},
          analyzedAt: null,
        };
      }
      await this.taService.saveSignal(fresh);
      return {
        symbol: fresh.symbol,
        timeframe: fresh.timeframe,
        taScore: fresh.taScore,
        recommendation: fresh.recommendation,
        indicators: fresh.indicators,
        analyzedAt: new Date().toISOString(),
      };
    }

    return {
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      taScore: signal.taScore,
      recommendation: signal.recommendation,
      indicators: signal.indicators,
      analyzedAt: signal.analyzedAt.toISOString(),
    };
  }

  /** Get OHLCV price history for charting or analysis */
  async getPriceHistory(
    symbol: string,
    timeframe: '1h' | '4h' | '1d',
    bars = 100,
  ): Promise<PriceHistoryResult> {
    const candles = await this.ohlcvRepo.find({
      where: { symbol: symbol.toUpperCase(), timeframe },
      order: { openTime: 'DESC' },
      take: bars,
    });

    return {
      symbol,
      timeframe,
      candles: candles.reverse().map((c) => ({
        time: c.openTime.toISOString(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      })),
    };
  }

  /** Get an overview of the market */
  async getMarketOverview(): Promise<MarketOverviewResult> {
    const tokens = await this.tokenRepo.find({
      where: { isActive: true },
      order: { volumeRank: 'ASC' },
    });

    const sorted = [...tokens].sort(
      (a, b) => Number(b.priceChangePct24h) - Number(a.priceChangePct24h),
    );

    const topGainers = sorted.slice(0, 5).map((t) => ({
      symbol: t.symbol,
      changePct: Number(t.priceChangePct24h),
      price: Number(t.lastPrice),
    }));

    const topLosers = sorted
      .slice(-5)
      .reverse()
      .map((t) => ({
        symbol: t.symbol,
        changePct: Number(t.priceChangePct24h),
        price: Number(t.lastPrice),
      }));

    const screenerTop = await this.screener.getScreenerResults(5, 55);

    return {
      topGainers,
      topLosers,
      topBySwingScore: screenerTop.map((r) => ({
        symbol: r.symbol,
        swingScore: r.swingScore,
        recommendation: r.recommendation,
      })),
      marketSummary: `Tracking ${tokens.length} tokens. Top swing setups: ${screenerTop.map((r) => r.symbol).join(', ')}`,
    };
  }

  // ─── Tool schema definitions for Gemini ─────────────────────────────────────

  /** Returns the tool declarations array for use with @google/genai */
  getToolDeclarations() {
    return [
      {
        name: 'getTopTokens',
        description:
          'Get the top-ranked crypto tokens by swing trading score. Returns symbol, scores, recommendation, and price change.',
        parameters: {
          type: 'object' as const,
          properties: {
            limit: {
              type: 'number',
              description: 'Number of tokens to return (default 10, max 50)',
            },
            minScore: {
              type: 'number',
              description: 'Minimum swing score filter (0-100)',
            },
          },
        },
      },
      {
        name: 'getTechnicalSignal',
        description:
          'Get detailed technical analysis signal for a specific crypto token and timeframe. Returns all indicator values and scores.',
        parameters: {
          type: 'object' as const,
          properties: {
            symbol: {
              type: 'string',
              description: 'Trading pair symbol, e.g. BTCUSDT, ETHUSDT',
            },
            timeframe: {
              type: 'string',
              enum: ['1h', '4h', '1d'],
              description: 'Analysis timeframe. Use 4h and 1d for swing trading.',
            },
          },
          required: ['symbol', 'timeframe'],
        },
      },
      {
        name: 'getPriceHistory',
        description:
          'Get OHLCV candlestick price history for a token. Useful for identifying trends and patterns.',
        parameters: {
          type: 'object' as const,
          properties: {
            symbol: { type: 'string', description: 'Trading pair symbol, e.g. BTCUSDT' },
            timeframe: {
              type: 'string',
              enum: ['1h', '4h', '1d'],
              description: 'Candle timeframe',
            },
            bars: {
              type: 'number',
              description: 'Number of candles to return (default 100)',
            },
          },
          required: ['symbol', 'timeframe'],
        },
      },
      {
        name: 'getMarketOverview',
        description:
          'Get a snapshot of overall market conditions: top gainers, losers, and best swing setups.',
        parameters: {
          type: 'object' as const,
          properties: {},
        },
      },
    ];
  }

  /** Dispatch a tool call by name */
  async callTool(name: string, args: Record<string, any>): Promise<unknown> {
    this.logger.debug(`Tool call: ${name}(${JSON.stringify(args)})`);

    switch (name) {
      case 'getTopTokens':
        return this.getTopTokens(args.limit ?? 10, args.minScore ?? 0);
      case 'getTechnicalSignal':
        return this.getTechnicalSignal(args.symbol, args.timeframe);
      case 'getPriceHistory':
        return this.getPriceHistory(args.symbol, args.timeframe, args.bars ?? 100);
      case 'getMarketOverview':
        return this.getMarketOverview();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
