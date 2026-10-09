import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { MultiFactorService } from './src/analysis/multifactor.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(MultiFactorService);
  const res = await service.compute('ASTRUSD', '4h', {}, 50);
  console.log('Last 5 candles:');
  for (const c of res.candles.slice(-5)) {
    console.log(new Date(c.time * 1000).toISOString(), c.close);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
