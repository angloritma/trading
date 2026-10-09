import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { KrakenModule } from './kraken/kraken.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { AnalysisModule } from './analysis/analysis.module';
import { AgentModule } from './agent/agent.module';
import { TokensModule } from './api/tokens/tokens.module';
import { ScreenerModule } from './api/screener/screener.module';
import { AgentApiModule } from './api/agent/agent-api.module';
import { ChartModule } from './api/chart/chart.module';
import { DB_ENTITIES } from './database/database.module';

@Module({
  imports: [
    // Core
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),

    // Database
    DatabaseModule,

    // Feature modules
    KrakenModule,
    IngestionModule,
    AnalysisModule,
    AgentModule,

    // API modules
    TokensModule,
    ScreenerModule,
    AgentApiModule,
    ChartModule,
  ],
})
export class AppModule {}

