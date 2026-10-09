/**
 * Seed script: inserts realistic OHLCV + token data for top-5 coins
 * using Kraken USD pair naming (BTCUSD, ETHUSD, etc.)
 *
 * Run with:  npx ts-node scripts/seed.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Token } from '../src/database/entities/token.entity';
import { Ohlcv } from '../src/database/entities/ohlcv.entity';

// ─── DB connection ─────────────────────────────────────────────────────────────
const ds = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'trading',
  username: process.env.POSTGRES_USER ?? 'trading',
  password: process.env.POSTGRES_PASSWORD ?? 'trading123',
  entities: [Token, Ohlcv],
  synchronize: false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCandles(
  symbol: string,
  timeframe: string,
  bars: number,
  startPrice: number,
  startTime: Date,
  intervalMs: number,
): Ohlcv[] {
  const candles: Ohlcv[] = [];
  let price = startPrice;

  for (let i = 0; i < bars; i++) {
    const openTime = new Date(startTime.getTime() + i * intervalMs);
    const closeTime = new Date(openTime.getTime() + intervalMs - 1);

    const change = price * (Math.random() * 0.04 - 0.02);
    const open = price;
    const close = Math.max(price + change, 0.001);
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    const volume = startPrice * 1000 * (0.5 + Math.random());

    const c = new Ohlcv();
    c.symbol = symbol;
    c.timeframe = timeframe;
    c.openTime = openTime;
    c.closeTime = closeTime;
    c.open = open;
    c.high = high;
    c.low = low;
    c.close = close;
    c.volume = volume;
    c.quoteVolume = volume * close;
    c.trades = Math.floor(Math.random() * 5000) + 500;

    candles.push(c);
    price = close;
  }
  return candles;
}

// ─── Kraken USD pair token definitions ────────────────────────────────────────

const TOKENS = [
  { symbol: 'BTCUSD', base: 'BTC', price: 62000, rank: 1 },
  { symbol: 'ETHUSD', base: 'ETH', price: 3200,  rank: 2 },
  { symbol: 'SOLUSD', base: 'SOL', price: 175,   rank: 3 },
  { symbol: 'ARBUSD', base: 'ARB', price: 0.20,  rank: 4 },
  { symbol: 'XRPUSD', base: 'XRP', price: 0.62,  rank: 5 },
  { symbol: 'ADAUSD', base: 'ADA', price: 0.48,  rank: 6 },
];

const TIMEFRAMES: Array<{ tf: string; intervalMs: number; bars: number }> = [
  { tf: '1h',  intervalMs: 60 * 60 * 1_000,      bars: 250 },
  { tf: '4h',  intervalMs: 4 * 60 * 60 * 1_000,  bars: 250 },
  { tf: '1d',  intervalMs: 24 * 60 * 60 * 1_000, bars: 250 },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await ds.initialize();
  console.log('✅ Connected to database');

  const tokenRepo = ds.getRepository(Token);
  const ohlcvRepo = ds.getRepository(Ohlcv);

  // Clear existing seed data to avoid conflicts
  await ohlcvRepo.clear();
  await tokenRepo.clear();
  console.log('  Cleared existing data');

  // Upsert tokens
  for (const t of TOKENS) {
    await tokenRepo.upsert({
      symbol: t.symbol,
      baseAsset: t.base,
      quoteAsset: 'USD',
      volumeRank: t.rank,
      quoteVolume24h: t.price * 1_000_000,
      priceChangePct24h: (Math.random() * 10 - 5),
      lastPrice: t.price,
      isActive: true,
    }, ['symbol']);
    console.log(`  Token upserted: ${t.symbol}`);
  }

  // Generate candles
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);

  for (const token of TOKENS) {
    for (const { tf, intervalMs, bars } of TIMEFRAMES) {
      const candles = generateCandles(token.symbol, tf, bars, token.price, ninetyDaysAgo, intervalMs);

      for (let i = 0; i < candles.length; i += 100) {
        await ohlcvRepo
          .createQueryBuilder()
          .insert()
          .into(Ohlcv)
          .values(candles.slice(i, i + 100))
          .orIgnore()
          .execute();
      }
      console.log(`  OHLCV seeded: ${token.symbol}/${tf} (${bars} bars)`);
    }
  }

  console.log('\n🎉 Kraken seed complete!');
  await ds.destroy();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
