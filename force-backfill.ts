import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { IngestionService } from './src/ingestion/ingestion.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ingestion = app.get(IngestionService);
  
  // Expose fetchAndStoreKlines if it's private, or just use typescript ignore
  await (ingestion as any).fetchAndStoreKlines({symbol: 'DOTUSD', altname: 'DOTUSD', wsname: 'DOT/USD'}, '1d', 1791369600, 1791542400);
  console.log("Forced fetch and store!");
  await app.close();
  process.exit(0);
}
bootstrap();
