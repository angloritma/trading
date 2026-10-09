import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokensController } from './tokens.controller';
import { AnalysisModule } from '../../analysis/analysis.module';
import { Token } from '../../database/entities/token.entity';
import { Ohlcv } from '../../database/entities/ohlcv.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Token, Ohlcv]), AnalysisModule],
  controllers: [TokensController],
})
export class TokensModule {}

