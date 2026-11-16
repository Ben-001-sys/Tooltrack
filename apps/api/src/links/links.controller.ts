import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { IsUUID } from 'class-validator';
import { CollectionsService } from '../collections/collections.service.js';
import { ToolsService } from '../tools/tools.service.js';
import { PrismaService } from '../prisma/index.js';
import { LinksService } from './links.service.js';

class AddToolDto {
  @IsUUID('4')
  toolId!: string;
}
const uuid = new ParseUUIDPipe({ version: '4' });
const body = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('api/v1/collections/:id/tools')
export class LinksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
    private readonly collections: CollectionsService,
    private readonly tools: ToolsService,
  ) {}

  @Get()
  async list(@Session() session: UserSession, @Param('id', uuid) id: string) {
    await this.collections.findOne(session.user.id, id);
    return this.tools.findManyByIds(
      session.user.id,
      await this.links.toolIds(id),
    );
  }

  @Post()
  add(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
    @Body(body) dto: AddToolDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.collections.findOne(session.user.id, id, tx);
      await this.tools.findOne(session.user.id, dto.toolId, tx);
      return this.links.add(dto.toolId, id, tx);
    });
  }

  @Delete(':toolId')
  @HttpCode(204)
  async remove(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
    @Param('toolId', uuid) toolId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.collections.findOne(session.user.id, id, tx);
      await this.tools.findOne(session.user.id, toolId, tx);
      await this.links.remove(toolId, id, tx);
    });
  }
}
