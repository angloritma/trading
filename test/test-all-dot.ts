import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const pairs = await kraken.getUsdPairs();
  for (const p of pairs.values()) {
    if (p.symbol.includes('DOT') || p.altname.includes('DOT') || p.wsname.includes('DOT')) {
      console.log(p);
    }
  }
  await app.close();
  process.exit(0);
}
bootstrap();
