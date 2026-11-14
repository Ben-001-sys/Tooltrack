
import { Module } from '@nestjs/common';

import { AuthModule } from '@thallesp/nestjs-better-auth';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { auth } from './auth/auth.js';
import { SessionController } from './auth/session.controller.js';

import { HealthController } from './health/health.controller.js';

import { ToolsModule } from './tools/index.js';

import { PrismaModule } from './prisma/index.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule.forRoot({
      auth,
    }),
    ToolsModule,
  ],
  controllers: [
    AppController,
    HealthController,
    SessionController,
  ],
  providers: [
    AppService,
  ],
})
export class AppModule {}
