import { Controller, Get, Param, Query, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AngloritmaService, AngloritmaResult } from '../../analysis/angloritma.service';
import { MultiFactorService, V2Result } from '../../analysis/multifactor.service';
import { Token } from '../../database/entities/token.entity';

@Controller('chart')
export class ChartController {
  constructor(
    private readonly angloritmaService: AngloritmaService,
    private readonly multiFactorService: MultiFactorService,
    @InjectRepository(Token)
    private readonly tokenRepo: Repository<Token>,
  ) {}

  /**
   * GET /api/chart/tokens
   * List all available tokens with ranks and 24h stats for dropdown selection
   */
  @Get('tokens')
  async getTokens() {
    const tokens = await this.tokenRepo.find({
      where: { isActive: true },
      order: { volumeRank: 'ASC' },
      select: ['symbol', 'baseAsset', 'quoteAsset', 'lastPrice', 'priceChangePct24h', 'volumeRank'],
    });
    return { data: tokens };
  }

  /**
   * GET /api/chart/angloritma/:symbol
   * Get candle diagram, EMA13, EMA21, Quant Trading Line, markers & simulation stats
   */
  @Get('angloritma/:symbol')
  async getAngloritma(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe: '4h' | '1d' = '1d',
    @Query('entryMode') entryMode: 'flexible' | 'strict' = 'flexible',
    @Query('tp') tp = '5.0',
    @Query('sl') sl = '5.0',
    @Query('limit') limit = '1000',
  ): Promise<AngloritmaResult> {
    const tf = (timeframe || '1d').toLowerCase() as '4h' | '1d';
    if (tf !== '4h' && tf !== '1d') {
      throw new BadRequestException('Timeframe must be 4h or 1d');
    }

    const mode = (entryMode || 'flexible').toLowerCase() as 'flexible' | 'strict';
    const tpPct = Math.max(0.1, parseFloat(tp) || 5.0);
    const slPct = Math.max(0.1, parseFloat(sl) || 5.0);
    const candleLimit = Math.min(1000, Math.max(50, parseInt(limit, 10) || 500));

    return this.angloritmaService.computeAngloritma(
      symbol,
      tf,
      mode,
      tpPct,
      slPct,
      candleLimit,
    );
  }

  /**
   * GET /api/chart/signals
   * Get all tokens that triggered a BUY signal during the past N days (default 7),
   * with filter by timeframe ('4h' | '1d' | 'all'), status, and entry mode.
   */
  @Get('signals')
  async getRecentBuySignals(
    @Query('timeframe') timeframe: '4h' | '1d' | 'all' = 'all',
    @Query('days') days = '7',
    @Query('entryMode') entryMode: 'flexible' | 'strict' = 'flexible',
    @Query('status') status: 'all' | 'active' | 'tp' | 'sl' = 'all',
  ) {
    const tf = (timeframe || 'all').toLowerCase() as '4h' | '1d' | 'all';
    const dayCount = parseInt(days, 10) || 7;
    const mode = (entryMode || 'flexible').toLowerCase() as 'flexible' | 'strict';
    const st = (status || 'all').toLowerCase() as 'all' | 'active' | 'tp' | 'sl';

    return this.angloritmaService.scanRecentBuySignals({
      timeframe: tf,
      days: dayCount,
      entryMode: mode,
      status: st,
    });
  }

  /**
   * GET /api/chart/multifactor/:symbol
   * Get Angloritma v2 (Multi-factor) data
   */
  @Get('multifactor/:symbol')
  async getMultifactor(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe: '4h' | '1d' = '1d',
    @Query('limit') limit = '1000',
  ): Promise<V2Result> {
    const tf = (timeframe || '1d').toLowerCase() as '4h' | '1d';
    if (tf !== '4h' && tf !== '1d') {
      throw new BadRequestException('Timeframe must be 4h or 1d');
    }
    const candleLimit = Math.min(1000, Math.max(50, parseInt(limit, 10) || 500));

    return this.multiFactorService.compute(symbol, tf, {}, candleLimit);
  }

  /**
   * GET /api/chart/multifactor-signals
   * Get all tokens that triggered a BUY signal for Angloritma v2
   */
  @Get('multifactor-signals')
  async getMultifactorSignals(
    @Query('timeframe') timeframe: '4h' | '1d' | 'all' = 'all',
    @Query('days') days = '7',
    @Query('status') status: 'all' | 'active' | 'tp' | 'sl' = 'all',
  ) {
    const tf = (timeframe || 'all').toLowerCase() as '4h' | '1d' | 'all';
    const dayCount = parseInt(days, 10) || 7;
    const st = (status || 'all').toLowerCase() as 'all' | 'active' | 'tp' | 'sl';

    return this.multiFactorService.scanRecentBuySignals({
      timeframe: tf,
      days: dayCount,
      status: st,
    });
  }
}
