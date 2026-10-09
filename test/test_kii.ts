import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { AngloritmaService } from './src/analysis/angloritma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(AngloritmaService);
  try {
    await service.computeAngloritma('KIIUSD', '1d', 'flexible', 5, 5, 500);
  } catch (e) {
    console.error('ERROR:', e.stack);
  }
  await app.close();
  process.exit(0);
}
bootstrap();
