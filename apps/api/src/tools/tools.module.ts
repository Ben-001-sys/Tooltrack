
import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/index.js';

import { CategoriesController } from './categories.controller.js';
import { TagsController } from './tags.controller.js';
import { ToolsController } from './tools.controller.js';
import { ToolsService } from './tools.service.js';
import { LinksModule } from '../links/links.module.js';

@Module({
  imports: [PrismaModule, LinksModule],
  controllers: [
    CategoriesController,
    TagsController,
    ToolsController,
  ],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
