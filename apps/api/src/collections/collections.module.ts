import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/index.js';
import { LinksModule } from '../links/links.module.js';
import { CollectionsService } from './collections.service.js';
import { CollectionsController } from './collections.controller.js';

@Module({
  imports: [PrismaModule, LinksModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
