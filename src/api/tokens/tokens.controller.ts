import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Token } from '../../database/entities/token.entity';
import { TaService } from '../../analysis/ta.service';
import { Ohlcv } from '../../database/entities/ohlcv.entity';

@Controller('tokens')
export class TokensController {
  constructor(
    @InjectRepository(Token) private readonly tokenRepo: Repository<Token>,
    @InjectRepository(Ohlcv) private readonly ohlcvRepo: Repository<Ohlcv>,
    private readonly taService: TaService,
  ) {}

  /** GET /api/tokens — paginated list of active tokens with latest scores */
  @Get()
  async findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const take = Math.min(parseInt(limit, 10), 100);
    const skip = (parseInt(page, 10) - 1) * take;

    const [tokens, total] = await this.tokenRepo.findAndCount({
      where: { isActive: true },
      order: { volumeRank: 'ASC' },
      take,
      skip,
    });

    return {
      data: tokens,
      meta: { page: parseInt(page, 10), limit: take, total, pages: Math.ceil(total / take) },
    };
  }

  /** GET /api/tokens/:symbol — token detail with latest TA signals */
  @Get(':symbol')
  async findOne(@Param('symbol') symbol: string) {
    const sym = symbol.toUpperCase();
    const token = await this.tokenRepo.findOne({ where: { symbol: sym } });
    if (!token) throw new NotFoundException(`Token ${sym} not found`);

    const signals = await Promise.all(
      ['1h', '4h', '1d'].map((tf) => this.taService.getLatestSignal(sym, tf)),
    );

    return {
      token,
      signals: {
        '1h': signals[0],
        '4h': signals[1],
        '1d': signals[2],
      },
    };
  }

  /** GET /api/tokens/:symbol/ohlcv — candlestick data */
  @Get(':symbol/ohlcv')
  async getOhlcv(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe = '4h',
    @Query('limit') limit = '200',
  ) {
    const sym = symbol.toUpperCase();
    const take = Math.min(parseInt(limit, 10), 1000);

    const candles = await this.ohlcvRepo.find({
      where: { symbol: sym, timeframe },
      order: { openTime: 'DESC' },
      take,
    });

    return {
      symbol: sym,
      timeframe,
      candles: candles.reverse().map((c) => ({
        time: c.openTime.toISOString(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
        quoteVolume: Number(c.quoteVolume),
      })),
    };
  }
}

