import { Controller, Get } from '@nestjs/common';
import { ToolsService } from './tools.service.js';

@Controller('api/v1/tags')
export class TagsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  list() {
    return this.tools.listTags();
  }
}
