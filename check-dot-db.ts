import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  for (const tf of ['1d', '4h']) {
    const rows = await repo.find({ where: { symbol: 'DOTUSD', timeframe: tf }, order: { openTime: 'ASC' } });
    console.log(`DOTUSD ${tf} Total rows: ${rows.length}`);
    if (rows.length > 0) {
      console.log(`  Oldest: ${new Date(rows[0].openTime).toISOString()}`);
      console.log(`  Newest: ${new Date(rows[rows.length-1].openTime).toISOString()}`);
    }
  }
  await app.close();
  process.exit(0);
}
bootstrap();
