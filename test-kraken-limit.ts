import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  
  const current = Math.floor(Date.now() / 1000);
  
  // Try to fetch 5 years of 1d
  const data1d = await kraken.getOhlcv('BTCUSD', '1d', current - 5 * 365 * 86400, current);
  console.log('1d candles:', data1d.length);
  
  // Try to fetch 500 days of 4h
  const data4h = await kraken.getOhlcv('BTCUSD', '4h', current - 500 * 86400, current);
  console.log('4h candles:', data4h.length);
  
  await app.close();
  process.exit(0);
}
bootstrap();
