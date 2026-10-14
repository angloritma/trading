import { Injectable, Logger } from '@nestjs/common';
import { MacroCategory, MacroEvent, MacroStatus, MacroSummary } from './macro.types';
import { MACRO_EVENTS_RAW } from './macro.data';

@Injectable()
export class MacroService {
  private readonly logger = new Logger(MacroService.name);

  /**
   * Return all events with real-time dynamic status computed relative to now.
   */
  getEventsWithStatus(now: Date = new Date()): MacroEvent[] {
    const nowTime = now.getTime();
    // WIB date (UTC + 7 hours)
    const wibNow = new Date(nowTime + 7 * 3600 * 1000);
    const todayWibStr = wibNow.toISOString().slice(0, 10);

    return MACRO_EVENTS_RAW.map((raw) => {
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
  }): { count: number; data: MacroEvent[] } {
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

    const nextFomc =
      futureEvents.find((e) => e.category === 'FOMC') || null;
    const nextCpi =
      futureEvents.find((e) => e.category === 'CPI') || null;
    const nextPpi =
      futureEvents.find((e) => e.category === 'PPI') || null;
    const nextNfp =
      futureEvents.find((e) => e.category === 'NFP') || null;

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
