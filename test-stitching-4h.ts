import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { KrakenService } from './src/kraken/kraken.service';
import { Ohlcv } from './src/database/entities/ohlcv.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const kraken = app.get(KrakenService);
  const repo: Repository<Ohlcv> = app.get(getRepositoryToken(Ohlcv));
  
  const rows = await repo.find({ where: { symbol: 'DOTUSD', timeframe: '4h' }, order: { openTime: 'DESC' }, take: 2 });
  if (rows.length > 0) {
    const lastDbTimeSec = Math.floor(new Date(rows[0].openTime).getTime() / 1000);
    console.log('Last DB candle (4h):', new Date(lastDbTimeSec * 1000).toISOString(), rows[0].close);
    
    const pair = await kraken.getPairBySymbol('DOTUSD');
    if (pair) {
      const liveCandles = await kraken.getOhlcv(pair.altname, '4h', lastDbTimeSec, Math.floor(Date.now() / 1000) + 100);
      console.log('Live candles from Kraken (since = ' + lastDbTimeSec + '):');
      liveCandles.forEach(lc => {
        console.log(' -', new Date(lc.openTime * 1000).toISOString(), lc.close);
      });
    }
  }
  
  await app.close();
  process.exit(0);
}
bootstrap();
