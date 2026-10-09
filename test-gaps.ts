import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  const rows = await repo.find({ where: { symbol: 'DOTUSD', timeframe: '1d' }, order: { openTime: 'ASC' } });
  
  let prevTime = rows[0].openTime.getTime();
  let gaps = 0;
  for (let i = 1; i < rows.length; i++) {
    const currTime = rows[i].openTime.getTime();
    if (currTime - prevTime !== 24 * 60 * 60 * 1000) {
      console.log(`Gap between ${new Date(prevTime).toISOString()} and ${new Date(currTime).toISOString()} (diff: ${(currTime - prevTime) / 3600000}h)`);
      gaps++;
    }
    prevTime = currTime;
  }
  console.log(`Total gaps: ${gaps}`);
  await app.close();
  process.exit(0);
}
bootstrap();
