import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  const results = await repo.find({
    where: { symbol: 'BTCUSD', timeframe: '1d' },
    order: { openTime: 'DESC' },
    take: 5
  });
  
  for (const r of results) {
    console.log(r.openTime.toISOString(), r.close);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
