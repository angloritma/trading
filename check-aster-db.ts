import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  for (const tf of ['1d', '4h']) {
    const rows = await repo.find({ where: { symbol: 'ASTERUSD', timeframe: tf } });
    console.log(`ASTERUSD ${tf} Total rows: ${rows.length}`);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
