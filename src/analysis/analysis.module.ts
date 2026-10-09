import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaService } from './ta.service';
import { ScreenerService } from './screener.service';
import { AngloritmaService } from './angloritma.service';
import { Ohlcv } from '../database/entities/ohlcv.entity';
import { AnalysisSignal } from '../database/entities/analysis-signal.entity';
import { Token } from '../database/entities/token.entity';

import { MultiFactorService } from './multifactor.service';

import { KrakenModule } from '../kraken/kraken.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ohlcv, AnalysisSignal, Token]),
    KrakenModule,
  ],
  providers: [TaService, ScreenerService, AngloritmaService, MultiFactorService],
  exports: [TaService, ScreenerService, AngloritmaService, MultiFactorService],
})
export class AnalysisModule {}
