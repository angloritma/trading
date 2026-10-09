import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KrakenService } from './kraken.service';
import { KrakenWsService } from './kraken-ws.service';
import { Ohlcv } from '../database/entities/ohlcv.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Ohlcv])],
  providers: [KrakenService, KrakenWsService],
  exports: [KrakenService, KrakenWsService],
})
export class KrakenModule {}

