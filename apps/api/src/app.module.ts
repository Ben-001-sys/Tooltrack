import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { auth } from './auth/auth.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SessionController } from './auth/session.controller.js';
import { AuthModule } from '@thallesp/nestjs-better-auth';

@Module({
  imports: [
    PrismaModule, 
    AuthModule.forRoot({
    auth,
  })
],
  controllers: [AppController, HealthController, SessionController],
  providers: [AppService],
})
export class AppModule {}
