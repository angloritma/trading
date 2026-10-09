import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const data = await kraken.getOhlcv('ASTERUSD', '1d', 0, 10000000000);
  console.log("Oldest candle:", new Date(data[0].openTime * 1000).toISOString());
  console.log("Total candles:", data.length);
  await app.close();
  process.exit(0);
}
bootstrap();
