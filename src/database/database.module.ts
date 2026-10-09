import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Token } from './entities/token.entity';
import { Ohlcv } from './entities/ohlcv.entity';
import { AnalysisSignal } from './entities/analysis-signal.entity';
import { AiRecommendation } from './entities/ai-recommendation.entity';
import { DataSource } from 'typeorm';

export const DB_ENTITIES = [Token, Ohlcv, AnalysisSignal, AiRecommendation];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get<number>('database.port'),
        database: config.get('database.name'),
        username: config.get('database.user'),
        password: config.get('database.password'),
        entities: DB_ENTITIES,
        synchronize: true, // auto-create tables on startup
        logging: config.get('nodeEnv') === 'development' ? ['error', 'warn'] : false,
        ssl: false,
      }),
      dataSourceFactory: async (options) => {
        const dataSource = new DataSource(options!);
        await dataSource.initialize();

        // Create TimescaleDB hypertable for ohlcv after TypeORM syncs the table
        try {
          await dataSource.query(`
            SELECT create_hypertable('ohlcv', by_range('open_time'), if_not_exists => TRUE);
          `);
          console.log('✅ TimescaleDB hypertable created for ohlcv');
        } catch (err) {
          // Not a fatal error — may already exist or TimescaleDB not available
          console.warn('⚠️  Could not create hypertable (may already exist):', err.message);
        }

        return dataSource;
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
