import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const liveCandles = await kraken.getOhlcv('DOTUSD', '1d', 1791369600, 1791542400); // 1791369600 is Oct 7
  for (const c of liveCandles) {
    if (new Date(c.openTime * 1000).toISOString().startsWith('2026-10-08')) {
      console.log('Kraken Oct 8:', c);
    }
  }
  await app.close();
  process.exit(0);
}
bootstrap();
