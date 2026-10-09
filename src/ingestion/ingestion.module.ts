import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestionService } from './ingestion.service';
import { KrakenModule } from '../kraken/kraken.module';
import { Token } from '../database/entities/token.entity';
import { Ohlcv } from '../database/entities/ohlcv.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Token, Ohlcv]),
    KrakenModule,
  ],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
