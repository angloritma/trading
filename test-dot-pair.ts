import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const pair = await kraken.getPairBySymbol('DOTUSD');
  console.log('Pair:', pair);
  await app.close();
  process.exit(0);
}
bootstrap();
