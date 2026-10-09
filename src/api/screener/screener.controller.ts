import { Controller, Get, Post, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ScreenerService } from '../../analysis/screener.service';
import { Recommendation } from '../../database/entities/analysis-signal.entity';

@Controller('screener')
export class ScreenerController {
  constructor(private readonly screener: ScreenerService) {}

  /**
   * GET /api/screener
   * Query params:
   *   limit        — number of results (default 50)
   *   minScore     — minimum swing score (0-100)
   *   recommendation — BUY | WATCH | NEUTRAL | AVOID
   */
  @Get()
  async getScreener(
    @Query('limit') limit = '50',
    @Query('minScore') minScore = '0',
    @Query('recommendation') recommendation?: string,
  ) {
    const rec = recommendation as Recommendation | undefined;
    const results = await this.screener.getScreenerResults(
      parseInt(limit, 10),
      parseInt(minScore, 10),
      rec,
    );
    return {
      count: results.length,
      data: results,
    };
  }

  /**
   * POST /api/screener/run
   * Manually trigger a full TA analysis run for all active tokens.
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runScreener() {
    await this.screener.runScreener();
    return { message: 'Screener analysis complete' };
  }
}

