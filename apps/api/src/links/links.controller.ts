import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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

@Controller('api/v1')
export class LinksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
    private readonly collections: CollectionsService,
    private readonly tools: ToolsService,
  ) {}

  @Get('collections/:id/tools')
  @Header('Cache-Control', 'private, no-store')
  list(@Session() session: UserSession, @Param('id', uuid) id: string) {
    return this.listTools(session.user.id, id, false);
  }

  @Get('public-collections/:id/tools')
  @Header('Cache-Control', 'private, no-store')
  listPublic(@Session() session: UserSession, @Param('id', uuid) id: string) {
    return this.listTools(session.user.id, id, true);
  }

  private listTools(userId: string, id: string, publicOnly: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const collection = await this.collections.findOne(
        userId,
        id,
        tx,
        publicOnly,
      );
      const links = await this.links.forCollection(id, tx);
      if (collection.visibility === 'PUBLIC') {
        return this.tools.findCollectionToolSummaries(
          links.map((link) => link.toolId),
          tx,
        );
      }

      const owned = await this.tools.findManyByIds(
        userId,
        links.map((link) => link.toolId),
        tx,
      );
      const ownedIds = new Set(owned.map((tool) => tool.id));
      // Verified contributions survive privatization with their public field set.
      const contributed = await this.tools.findCollectionToolSummaries(
        links
          .filter(
            (link) => link.addedByUserId !== null && !ownedIds.has(link.toolId),
          )
          .map((link) => link.toolId),
        tx,
      );
      return [...owned, ...contributed];
    });
  }

  @Post('collections/:id/tools')
  add(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
    @Body(body) dto: AddToolDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.collections.findOne(session.user.id, id, tx);
      await this.tools.findOne(session.user.id, dto.toolId, tx);
      return this.links.add(dto.toolId, id, session.user.id, tx);
    });
  }

  @Delete('collections/:id/tools/:toolId')
  @HttpCode(204)
  async remove(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
    @Param('toolId', uuid) toolId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.collections.findOne(session.user.id, id, tx);
      await this.links.remove(toolId, id, tx);
    });
  }
}
