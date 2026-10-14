import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { MacroCategory, MacroEvent, MacroStatus, MacroSummary } from './macro.types';
import { MACRO_EVENTS_RAW } from './macro.data';

interface ExternalCalendarEvent {
  id?: string;
  title: string;
  indicator?: string;
  country: string;
  date: string;
  importance?: number;
  period?: string;
  previous?: number | string | null;
  forecast?: number | string | null;
  actual?: number | string | null;
  unit?: string;
  comment?: string;
}

@Injectable()
export class MacroService implements OnModuleInit {
  private readonly logger = new Logger(MacroService.name);

  /** In-memory state of macro events that gets enriched and updated by cron sync */
  private eventsState: Map<string, Omit<MacroEvent, 'status'>> = new Map();
  private lastSyncTime: string | null = null;
  private lastSyncStatus: 'SUCCESS' | 'ERROR' | 'IDLE' = 'IDLE';
  private syncedCount = 0;

  constructor() {
    this.resetToDefaults();
  }

  private resetToDefaults() {
    this.eventsState.clear();
    for (const raw of MACRO_EVENTS_RAW) {
      this.eventsState.set(raw.id, { ...raw });
    }
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('📅 MacroService initialized. Running initial live feed sync in background...');
    // Non-blocking background sync on startup
    this.syncFromFeed().catch((err) => {
      this.logger.warn(`Startup macro feed sync warning: ${err.message}`);
    });
  }

  /**
   * Cron job running every hour to automatically sync latest macro releases and forecasts
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyCron(): Promise<void> {
    this.logger.log('⏰ Hourly cron: syncing macroeconomic calendar data from live feed...');
    await this.syncFromFeed();
  }

  /**
   * Additional cron job running every 15 minutes during active US market hours (12:00 - 20:00 UTC)
   * to catch real-time data releases (e.g. 08:30 ET and 14:00 ET FOMC decisions)
   */
  @Cron('*/15 12-21 * * 1-5')
  async handleMarketHoursCron(): Promise<void> {
    this.logger.debug('📊 High-frequency market-hours cron: checking for new macro releases...');
    await this.syncFromFeed();
  }

  /**
   * Fetch from public economic calendar JSON feed and merge actual & forecast values
   */
  async syncFromFeed(): Promise<{ success: boolean; updatedCount: number; lastSyncTime: string; message: string }> {
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 25 * 86400000).toISOString();
      const to = new Date(now.getTime() + 45 * 86400000).toISOString();

      this.logger.log(`🔄 Fetching live economic calendar feed [${from.slice(0, 10)} to ${to.slice(0, 10)}]...`);

      let feedEvents: ExternalCalendarEvent[] = [];

      // Primary source: TradingView Economic Calendar public JSON endpoint
      try {
        const res = await axios.get('https://economic-calendar.tradingview.com/events', {
          params: { from, to, countries: 'US' },
          headers: {
            Origin: 'https://www.tradingview.com',
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });

        if (res.data?.status === 'ok' && Array.isArray(res.data?.result)) {
          feedEvents = res.data.result;
          this.logger.log(`📥 Received ${feedEvents.length} items from TradingView economic calendar`);
        }
      } catch (tvErr: any) {
        this.logger.warn(`TradingView feed fetch failed: ${tvErr.message}. Trying ForexFactory backup feed...`);
      }

      // Secondary backup source: Faireconomy / ForexFactory weekly JSON feed
      if (feedEvents.length === 0) {
        try {
          const ffRes = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 8000,
          });

          if (Array.isArray(ffRes.data)) {
            feedEvents = ffRes.data
              .filter((e: any) => e.country === 'USD')
              .map((e: any) => ({
                title: e.title,
                country: 'US',
                date: e.date,
                previous: e.previous,
                forecast: e.forecast,
                actual: e.actual,
              }));
            this.logger.log(`📥 Received ${feedEvents.length} USD items from Faireconomy feed`);
          }
        } catch (ffErr: any) {
          this.logger.warn(`Backup Faireconomy feed failed: ${ffErr.message}`);
        }
      }

      if (feedEvents.length === 0) {
        throw new Error('Semua feed kalender eksternal tidak memberikan data.');
      }

      let updatedCount = 0;

      // Merge feed into internal eventsState
      for (const [id, event] of this.eventsState.entries()) {
        const rawDateStr = event.datetimeUtc.slice(0, 10);

        // Find candidate matches in feed on the same date (+/- 1 day)
        const candidates = feedEvents.filter((tv) => {
          const tvDateStr = tv.date ? tv.date.slice(0, 10) : '';
          const diffDays = Math.abs(new Date(tvDateStr).getTime() - new Date(rawDateStr).getTime()) / 86400000;
          if (diffDays > 1.2) return false;

          const tvTitle = (tv.title + ' ' + (tv.indicator || '')).toLowerCase();

          if (event.category === 'PPI') {
            return tvTitle.includes('ppi yoy') || (tvTitle.includes('ppi') && tvTitle.includes('producer'));
          }
          if (event.category === 'CPI') {
            return tvTitle.includes('inflation rate yoy') || tvTitle.includes('cpi yoy') || tvTitle.includes('core cpi');
          }
          if (event.category === 'FOMC') {
            return (
              tvTitle.includes('fed interest rate decision') ||
              tvTitle.includes('federal funds rate') ||
              tvTitle.includes('interest rate decision')
            );
          }
          if (event.category === 'NFP') {
            return tvTitle.includes('non farm payrolls') || tvTitle.includes('nonfarm payrolls');
          }
          if (event.category === 'PCE') {
            return tvTitle.includes('core pce price index yoy') || tvTitle.includes('pce price index');
          }
          if (event.category === 'GDP') {
            return tvTitle.includes('gdp growth rate') || tvTitle.includes('gdp sales qoq');
          }
          return false;
        });

        if (candidates.length > 0) {
          const match = candidates[0];
          const unit = match.unit ? `${match.unit}` : '';
          let changed = false;

          // Update actual if available from feed
          if (match.actual !== null && match.actual !== undefined && match.actual !== '') {
            const actualStr = `${match.actual}${unit ? (unit.startsWith('%') ? unit : ' ' + unit) : ''}`;
            if (event.actual !== actualStr) {
              event.actual = actualStr;
              changed = true;
            }
          }

          // Update forecast if available
          if (match.forecast !== null && match.forecast !== undefined && match.forecast !== '') {
            const forecastStr = `${match.forecast}${unit ? (unit.startsWith('%') ? unit : ' ' + unit) : ''}`;
            if (event.forecast !== forecastStr) {
              event.forecast = forecastStr;
              changed = true;
            }
          }

          // Update previous if available
          if (match.previous !== null && match.previous !== undefined && match.previous !== '') {
            const prevStr = `${match.previous}${unit ? (unit.startsWith('%') ? unit : ' ' + unit) : ''}`;
            if (event.previous !== prevStr) {
              event.previous = prevStr;
              changed = true;
            }
          }

          if (changed) {
            updatedCount++;
            this.eventsState.set(id, event);
          }
        }
      }

      this.lastSyncTime = new Date().toISOString();
      this.lastSyncStatus = 'SUCCESS';
      this.syncedCount = updatedCount;

      this.logger.log(`✅ Macro sync complete: ${updatedCount} events updated with latest forecast/actual data`);

      return {
        success: true,
        updatedCount,
        lastSyncTime: this.lastSyncTime,
        message: `Sinkronisasi berhasil: ${updatedCount} event diperbarui dengan data rilis & forecast terbaru.`,
      };
    } catch (err: any) {
      this.lastSyncStatus = 'ERROR';
      this.logger.error(`Macro feed sync error: ${err.message}`);
      return {
        success: false,
        updatedCount: 0,
        lastSyncTime: this.lastSyncTime || new Date().toISOString(),
        message: `Sinkronisasi gagal: ${err.message}`,
      };
    }
  }

  /**
   * Return all events with real-time dynamic status computed relative to now.
   */
  getEventsWithStatus(now: Date = new Date()): MacroEvent[] {
    const nowTime = now.getTime();
    // WIB date (UTC + 7 hours)
    const wibNow = new Date(nowTime + 7 * 3600 * 1000);
    const todayWibStr = wibNow.toISOString().slice(0, 10);

    const list = Array.from(this.eventsState.values());

    return list.map((raw) => {
      const eventTime = new Date(raw.datetimeUtc).getTime();
      const eventWib = new Date(eventTime + 7 * 3600 * 1000);
      const eventWibStr = eventWib.toISOString().slice(0, 10);
      const isPast = eventTime < nowTime;
      const isToday = eventWibStr === todayWibStr;

      let status: MacroStatus = 'UPCOMING';
      if (isToday) {
        status = 'TODAY';
      } else if (isPast) {
        status = 'COMPLETED';
      } else {
        status = 'UPCOMING';
      }

      return {
        ...raw,
        status,
      };
    });
  }

  /**
   * Filter and sort events based on criteria
   */
  getEvents(params: {
    category?: string;
    timeframe?: 'upcoming' | 'today' | 'month' | 'past' | 'all';
    search?: string;
    limit?: number;
  }): { count: number; data: MacroEvent[]; lastSyncTime: string | null } {
    const now = new Date();
    const wibNow = new Date(now.getTime() + 7 * 3600 * 1000);
    const currentMonthStr = wibNow.toISOString().slice(0, 7); // "2026-10"
    let events = this.getEventsWithStatus(now);

    // 1. Filter Category
    if (params.category && params.category.toUpperCase() !== 'ALL') {
      const cat = params.category.toUpperCase() as MacroCategory;
      events = events.filter((e) => e.category === cat);
    }

    // 2. Filter Timeframe
    const tf = (params.timeframe || 'upcoming').toLowerCase();
    if (tf === 'upcoming') {
      events = events.filter((e) => e.status === 'UPCOMING' || e.status === 'TODAY');
      events.sort((a, b) => new Date(a.datetimeUtc).getTime() - new Date(b.datetimeUtc).getTime());
    } else if (tf === 'today') {
      events = events.filter((e) => e.status === 'TODAY');
      events.sort((a, b) => new Date(a.datetimeUtc).getTime() - new Date(b.datetimeUtc).getTime());
    } else if (tf === 'month') {
      events = events.filter((e) => {
        const evtWib = new Date(new Date(e.datetimeUtc).getTime() + 7 * 3600 * 1000);
        return evtWib.toISOString().startsWith(currentMonthStr);
      });
      events.sort((a, b) => new Date(a.datetimeUtc).getTime() - new Date(b.datetimeUtc).getTime());
    } else if (tf === 'past') {
      events = events.filter((e) => e.status === 'COMPLETED');
      events.sort((a, b) => new Date(b.datetimeUtc).getTime() - new Date(a.datetimeUtc).getTime());
    } else {
      // 'all': upcoming first (asc), then past (desc)
      const upcoming = events
        .filter((e) => e.status === 'UPCOMING' || e.status === 'TODAY')
        .sort((a, b) => new Date(a.datetimeUtc).getTime() - new Date(b.datetimeUtc).getTime());
      const past = events
        .filter((e) => e.status === 'COMPLETED')
        .sort((a, b) => new Date(b.datetimeUtc).getTime() - new Date(a.datetimeUtc).getTime());
      events = [...upcoming, ...past];
    }

    // 3. Search query
    if (params.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      events = events.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.period.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.cryptoImpact.summary.toLowerCase().includes(q),
      );
    }

    // 4. Limit
    if (params.limit && params.limit > 0) {
      events = events.slice(0, params.limit);
    }

    return {
      count: events.length,
      data: events,
      lastSyncTime: this.lastSyncTime,
    };
  }

  /**
   * Return high-level summary with countdowns and key indicators
   */
  getSummary(): MacroSummary {
    const now = new Date();
    const wibNow = new Date(now.getTime() + 7 * 3600 * 1000);
    const currentMonthStr = wibNow.toISOString().slice(0, 7);
    const events = this.getEventsWithStatus(now);

    const futureEvents = events
      .filter((e) => new Date(e.datetimeUtc).getTime() > now.getTime())
      .sort((a, b) => new Date(a.datetimeUtc).getTime() - new Date(b.datetimeUtc).getTime());

    const nextEvt = futureEvents[0] || null;
    let nextEventInfo: MacroSummary['nextEvent'] = null;

    if (nextEvt) {
      const diffMs = Math.max(0, new Date(nextEvt.datetimeUtc).getTime() - now.getTime());
      const remainingSeconds = Math.floor(diffMs / 1000);
      const days = Math.floor(remainingSeconds / 86400);
      const hours = Math.floor((remainingSeconds % 86400) / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      const seconds = remainingSeconds % 60;

      nextEventInfo = {
        event: nextEvt,
        remainingSeconds,
        days,
        hours,
        minutes,
        seconds,
      };
    }

    const nextFomc = futureEvents.find((e) => e.category === 'FOMC') || null;
    const nextCpi = futureEvents.find((e) => e.category === 'CPI') || null;
    const nextPpi = futureEvents.find((e) => e.category === 'PPI') || null;
    const nextNfp = futureEvents.find((e) => e.category === 'NFP') || null;

    const todayEventsCount = events.filter((e) => e.status === 'TODAY').length;
    const upcomingEventsCount = futureEvents.length;
    const thisMonthEventsCount = events.filter((e) => {
      const evtWib = new Date(new Date(e.datetimeUtc).getTime() + 7 * 3600 * 1000);
      return evtWib.toISOString().startsWith(currentMonthStr);
    }).length;

    return {
      now: now.toISOString(),
      currentFedRate: '4.75% - 5.00%',
      nextEvent: nextEventInfo,
      todayEventsCount,
      upcomingEventsCount,
      thisMonthEventsCount,
      nextFomc,
      nextCpi,
      nextPpi,
      nextNfp,
      lastSyncTime: this.lastSyncTime || undefined,
      lastSyncStatus: this.lastSyncStatus,
      syncedEventsCount: this.syncedCount,
    };
  }

  /**
   * Get category breakdown with counts
   */
  getCategories(): { category: MacroCategory; label: string; count: number }[] {
    const events = this.getEventsWithStatus(new Date());
    const categories: { category: MacroCategory; label: string }[] = [
      { category: 'FOMC', label: 'FOMC (Suku Bunga The Fed)' },
      { category: 'CPI', label: 'CPI (Inflasi Konsumen)' },
      { category: 'PPI', label: 'PPI (Inflasi Produsen)' },
      { category: 'PCE', label: 'Core PCE (Pengukur Fed)' },
      { category: 'NFP', label: 'NFP & Ketenagakerjaan' },
      { category: 'GDP', label: 'GDP (PDB Ekonomi AS)' },
    ];

    return categories.map((cat) => ({
      ...cat,
      count: events.filter((e) => e.category === cat.category).length,
    }));
  }
}
