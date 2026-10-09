import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  for (const tf of ['1d', '4h']) {
    const rows = await repo.find({ where: { symbol: 'ASTERUSD', timeframe: tf }, order: { openTime: 'ASC' } });
    if (rows.length === 0) {
      console.log(`No rows for ASTERUSD ${tf}`);
      continue;
    }
    console.log(`Last DB time for ${tf}:`, rows[rows.length-1].openTime.toISOString());
    let gaps = 0;
    for (let i = 1; i < rows.length; i++) {
      const diff = rows[i].openTime.getTime() - rows[i-1].openTime.getTime();
      const expected = tf === '1d' ? 24 * 3600 * 1000 : 4 * 3600 * 1000;
      if (diff !== expected) {
        console.log('GAP!', rows[i-1].openTime.toISOString(), '->', rows[i].openTime.toISOString(), 'diff:', diff / 3600000, 'hours');
        gaps++;
      }
    }
    console.log(`ASTERUSD ${tf} Total rows: ${rows.length}, Total gaps: ${gaps}`);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
