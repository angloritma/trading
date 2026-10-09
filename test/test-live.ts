import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const since = Math.floor(new Date('2026-10-05T00:00:00Z').getTime() / 1000);
  const data = await kraken.getOhlcv('XBTUSD', '1d', since, Math.floor(Date.now() / 1000) + 100000);
  console.log("length:", data.length);
  for (const d of data) {
    console.log(new Date(d.openTime * 1000).toISOString(), d.close);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
