import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  const count1d = await repo.count({ where: { symbol: 'ASTRUSD', timeframe: '1d' }});
  const count4h = await repo.count({ where: { symbol: 'ASTRUSD', timeframe: '4h' }});
  const count1h = await repo.count({ where: { symbol: 'ASTRUSD', timeframe: '1h' }});
  
  console.log(`ASTRUSD: 1d=${count1d}, 4h=${count4h}, 1h=${count1h}`);
  
  await app.close();
  process.exit(0);
}
bootstrap();
