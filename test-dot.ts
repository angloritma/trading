import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const p = await kraken.getCurrentPrice('DOTUSD');
  console.log('DOTUSD price:', p);
  await app.close();
  process.exit(0);
}
bootstrap();
