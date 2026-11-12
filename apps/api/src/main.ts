import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.PORT
    ? Number(process.env.PORT)
    : 3001;

  await app.listen(port);

  console.log(`ToolTrack API running at http://localhost:${port}`)
}

void bootstrap();
