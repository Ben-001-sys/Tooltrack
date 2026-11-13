
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function loadLocalEnvironment(): void {
  const possiblePaths = [
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '.env'),
  ];

  for (const filePath of possiblePaths) {
    if (existsSync(filePath)) {
      process.loadEnvFile(filePath);
      return;
    }
  }
}

async function bootstrap(): Promise<void> {
  loadLocalEnvironment();

  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  const port = process.env.PORT
    ? Number(process.env.PORT)
    : 3001;

  await app.listen(port);

  console.log(
    `ToolTrack API running at http://localhost:${port}`,
  );
}

void bootstrap();
