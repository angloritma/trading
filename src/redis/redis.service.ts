import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('redis.host', 'localhost');
    const port = this.config.get<number>('redis.port', 6379);
    const username = this.config.get<string>('redis.user', 'default');
    const password = this.config.get<string>('redis.password', '');
    const useTls = this.config.get<boolean>('redis.tls', false);

    this.logger.log(`Connecting to Redis/Valkey at ${host}:${port} (TLS: ${useTls})...`);

    this.client = new Redis({
      host,
      port,
      username,
      password: password || undefined,
      tls: useTls ? { rejectUnauthorized: false } : undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.client.on('connect', () => {
      this.logger.log(`✅ Connected to Redis/Valkey at ${host}:${port}`);
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis/Valkey connection error: ${err.message}`);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      if (!this.client) return null;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      this.logger.warn(`Redis GET error for key ${key}: ${err.message}`);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      if (!this.client) return;
      const str = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, str, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, str);
      }
    } catch (err) {
      this.logger.warn(`Redis SET error for key ${key}: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Disconnected from Redis/Valkey');
    }
  }
}

