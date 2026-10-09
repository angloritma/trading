import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const data = await kraken.getOhlcv('XBTUSD', '1d', Math.floor(Date.now()/1000) - 86400, Math.floor(Date.now() / 1000));
  console.log(JSON.stringify(data[data.length-1], null, 2));
  await app.close();
  process.exit(0);
}
bootstrap();
