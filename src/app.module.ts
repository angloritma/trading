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
import { MacroModule } from './api/macro/macro.module';
import { DB_ENTITIES } from './database/database.module';
import { RedisModule } from './redis/redis.module';

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

    // Database & Caching
    DatabaseModule,
    RedisModule,

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
    MacroModule,
  ],
})
export class AppModule {}

