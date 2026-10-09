import { Module } from '@nestjs/common';
import { ScreenerController } from './screener.controller';
import { AnalysisModule } from '../../analysis/analysis.module';

@Module({
  imports: [AnalysisModule],
  controllers: [ScreenerController],
})
export class ScreenerModule {}

