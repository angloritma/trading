import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  const rows = await repo.find({ where: { symbol: 'DOTUSD', timeframe: '1d' }, order: { openTime: 'DESC' }, take: 10 });
  for (const r of rows) {
    console.log(r.openTime.toISOString(), r.open, r.high, r.low, r.close);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
