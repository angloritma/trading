import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Token } from './src/database/entities/token.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo: Repository<Token> = app.get(getRepositoryToken(Token));
  const tokens = await repo.find();
  console.log(tokens.map(t => t.symbol).filter(s => s.includes('ASTR')));
  await app.close();
  process.exit(0);
}
bootstrap();
