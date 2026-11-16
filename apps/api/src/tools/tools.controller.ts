import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  ValidationPipe,
} from '@nestjs/common';

import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { CreateToolDto } from './dto/create-tool.dto.js';
import { UpdateToolDto } from './dto/update-tool.dto.js';
import { ToolsService } from './tools.service.js';

@Controller('api/v1/tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  async findAll(@Session() session: UserSession) {
    return this.toolsService.list(session.user.id);
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
    return this.toolsService.create(session.user.id, dto);
  }

  @Get(':id')
  findOne(
    @Session() session: UserSession,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.toolsService.findOne(session.user.id, id);
  }

  @Patch(':id')
  update(
    @Session() session: UserSession,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateToolDto,
  ) {
    return this.toolsService.update(session.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Session() session: UserSession,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    await this.toolsService.remove(session.user.id, id);
  }
}
