
import {
  Body,
  Controller,
  Get,
  Post,
  ValidationPipe,
} from '@nestjs/common';

import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { CreateToolDto } from './dto/create-tool.dto.js';
import { ToolsService } from './tools.service.js';

@Controller('api/v1/tools')
export class ToolsController {
  constructor(
    private readonly toolsService: ToolsService,
  ) {}

  @Get()
  async findAll(
    @Session() session: UserSession,
  ) {
    return this.toolsService.list(
      session.user.id,
    );
  }

  @Post()
  async create(
    @Session() session: UserSession,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: CreateToolDto,
  ) {
    return this.toolsService.create(
      session.user.id,
      dto,
    );
  }
}
