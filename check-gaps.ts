import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  const rows = await repo.find({ where: { symbol: 'BTCUSD', timeframe: '4h' }, order: { openTime: 'ASC' } });
  
  let gaps = 0;
  for (let i = 1; i < rows.length; i++) {
    const diff = rows[i].openTime.getTime() - rows[i-1].openTime.getTime();
    if (diff !== 4 * 3600 * 1000) {
      console.log('GAP!', rows[i-1].openTime.toISOString(), '->', rows[i].openTime.toISOString(), 'diff:', diff / 3600000, 'hours');
      gaps++;
    }
  }
  console.log(`Total rows: ${rows.length}, Total gaps: ${gaps}`);
  await app.close();
  process.exit(0);
}
bootstrap();
