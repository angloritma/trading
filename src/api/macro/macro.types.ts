export type MacroCategory = 'FOMC' | 'CPI' | 'PPI' | 'PCE' | 'NFP' | 'GDP';
export type MacroImpact = 'HIGH' | 'MEDIUM' | 'LOW';
export type MacroStatus = 'UPCOMING' | 'TODAY' | 'COMPLETED';

export interface MacroEvent {
  id: string;
  title: string;
  category: MacroCategory;
  country: string;
  flag: string;
  datetimeUtc: string; // ISO 8601 string in UTC, e.g. "2026-10-28T18:00:00Z"
  dateFormatted: string; // "28 Okt 2026"
  timeUtc: string; // "18:00 UTC"
  timeWib: string; // "01:00 WIB (+1 hari)"
  period: string; // "Oktober 2026" or "Data September 2026"
  impact: MacroImpact;
  status: MacroStatus;
  previous?: string;
  forecast?: string;
  actual?: string;
  unit?: string;
  description: string;
  cryptoImpact: {
    summary: string;
    bullishScenario: string;
    bearishScenario: string;
  };
  source: string;
  sourceUrl?: string;
  hasPressConference?: boolean;
  isSep?: boolean; // Summary of Economic Projections (Dot Plot)
}

export interface MacroSummary {
  now: string;
  currentFedRate: string;
  nextEvent: {
    event: MacroEvent;
    remainingSeconds: number;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null;
  todayEventsCount: number;
  upcomingEventsCount: number;
  thisMonthEventsCount: number;
  nextFomc: MacroEvent | null;
  nextCpi: MacroEvent | null;
  nextPpi: MacroEvent | null;
  nextNfp: MacroEvent | null;
}
