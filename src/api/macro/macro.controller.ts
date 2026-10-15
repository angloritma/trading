import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MacroService } from './macro.service';

@Controller('macro')
export class MacroController {
  constructor(private readonly macroService: MacroService) {}

  /**
   * GET /api/macro/events
   * Query params:
   *   category   — FOMC | CPI | PPI | PCE | NFP | GDP | ALL
   *   timeframe  — upcoming | today | month | past | all
   *   search     — text search string
   *   limit      — number of items
   */
  @Get('events')
  getEvents(
    @Query('category') category?: string,
    @Query('timeframe') timeframe?: 'upcoming' | 'today' | 'month' | 'past' | 'all',
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : undefined;
    return this.macroService.getEvents({
      category,
      timeframe,
      search,
      limit: lim,
    });
  }

  /**
   * GET /api/macro/summary
   * High-level summary, next upcoming event, countdown, current Fed rate
   */
  @Get('summary')
  getSummary() {
    return this.macroService.getSummary();
  }

  /**
   * GET /api/macro/categories
   * List of available event categories with event counts
   */
  @Get('categories')
  getCategories() {
    return this.macroService.getCategories();
  }

  /**
   * GET /api/macro/history/:category
   * Return multi-year historical series for CPI, PPI, FOMC, or NFP
   */
  @Get('history/:category')
  getHistory(@Param('category') category: string) {
    return this.macroService.getHistory(category);
  }

  /**
   * POST /api/macro/sync & GET /api/macro/sync
   * Trigger manual sync with live economic calendar feed
   */
  @Get('sync')
  syncGet() {
    return this.macroService.syncFromFeed();
  }

  @Post('sync')
  syncPost() {
    return this.macroService.syncFromFeed();
  }
}

