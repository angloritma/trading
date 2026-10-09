import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import configuration from './config/configuration';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const config = configuration();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Global prefix for API endpoints
  app.setGlobalPrefix('api');

  // CORS for local development
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Serve static assets and web pages from public/ folder
  const publicDir = join(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.use('/chart', (_req: express.Request, res: express.Response) => {
    res.sendFile(join(publicDir, 'index.html'));
  });
  app.use('/signals', (_req: express.Request, res: express.Response) => {
    res.sendFile(join(publicDir, 'signals.html'));
  });

  await app.listen(config.port);
  logger.log(`🚀 Trading Dashboard running on http://localhost:${config.port}/api`);
  logger.log(`🤖 Gemini model: ${config.gemini.model}`);
  logger.log(`📊 Tracking top ${config.ingestion.topTokensCount} tokens`);
}

bootstrap();
