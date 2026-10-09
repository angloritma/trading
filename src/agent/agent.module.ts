import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentService } from './agent.service';
import { AgentTools } from './agent-tools';
import { AnalysisModule } from '../analysis/analysis.module';
import { AiRecommendation } from '../database/entities/ai-recommendation.entity';
import { Ohlcv } from '../database/entities/ohlcv.entity';
import { Token } from '../database/entities/token.entity';
import { AnalysisSignal } from '../database/entities/analysis-signal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiRecommendation, Ohlcv, Token, AnalysisSignal]),
    AnalysisModule,
  ],
  providers: [AgentService, AgentTools],
  exports: [AgentService, AgentTools],
})
export class AgentModule {}

