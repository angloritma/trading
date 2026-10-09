export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    name: process.env.POSTGRES_DB || 'trading',
    user: process.env.POSTGRES_USER || 'trading',
    password: process.env.POSTGRES_PASSWORD || 'trading123',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  kraken: {
    apiKey: process.env.KRAKEN_API_KEY || '',
    baseUrl: process.env.KRAKEN_BASE_URL || 'https://api.kraken.com',
    wsUrl: process.env.KRAKEN_WS_URL || 'wss://ws.kraken.com/v2',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },

  ingestion: {
    topTokensCount: parseInt(process.env.TOP_TOKENS_COUNT || '100', 10),
    backfillDays: parseInt(process.env.BACKFILL_DAYS || '90', 10),
    timeframes: ['1h', '4h', '1d'] as const,
  },
});
