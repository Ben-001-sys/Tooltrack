import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/index.js';
import { LinksModule } from '../links/index.js';
import { ToolsModule } from '../tools/index.js';
import { CollectionsService } from './collections.service.js';
import {
  CollectionsController,
  PublicCollectionsController,
} from './collections.controller.js';

@Module({
  imports: [PrismaModule, LinksModule, ToolsModule],
  controllers: [CollectionsController, PublicCollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
