import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const current4h = Math.floor(Date.now() / 1000);
  const since = current4h - 3 * (4 * 3600); // 3 candles ago
  
  const data = await kraken.getOhlcv('XBTUSD', '4h', since, current4h + 100);
  console.log("length:", data.length);
  for (const d of data) {
    console.log(new Date(d.openTime * 1000).toISOString());
  }
  await app.close();
  process.exit(0);
}
bootstrap();
