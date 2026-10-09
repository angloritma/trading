import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  // Get the current 4h candle open time
  const current4h = Math.floor(Date.now() / 1000);
  const since = current4h - (current4h % (4 * 3600));
  
  console.log("since:", new Date(since * 1000).toISOString());
  
  const data = await kraken.getOhlcv('XBTUSD', '4h', since, current4h + 100);
  console.log("length:", data.length);
  for (const d of data) {
    console.log(new Date(d.openTime * 1000).toISOString(), d.close);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
