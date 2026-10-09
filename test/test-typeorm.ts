import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  const qb = repo.createQueryBuilder().insert().into(Ohlcv).values([]).orUpdate(['close'], ['symbol', 'timeframe', 'open_time']);
  console.log(qb.getSql());
  
  await app.close();
  process.exit(0);
}
bootstrap();
