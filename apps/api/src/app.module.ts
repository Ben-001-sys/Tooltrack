
import { Module } from '@nestjs/common';

import { AuthModule } from '@thallesp/nestjs-better-auth';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { auth } from './auth/auth.js';
import { SessionController } from './auth/session.controller.js';

import { HealthController } from './health/health.controller.js';

import { ToolsModule } from './tools/index.js';

import { PrismaModule } from './prisma/index.js';
import { CollectionsModule } from './collections/collections.module.js';
import { LinksModule } from './links/links.module.js';
import { LinksController } from './links/links.controller.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule.forRoot({
      auth,
    }),
    ToolsModule,
    CollectionsModule,
    LinksModule,
  ],
  controllers: [
    AppController,
    HealthController,
    SessionController,
    // Compose the public module services here without circular module imports.
    LinksController,
  ],
  providers: [
    AppService,
  ],
})
export class AppModule {}
