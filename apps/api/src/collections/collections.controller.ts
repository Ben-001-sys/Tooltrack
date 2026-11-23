import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Collection } from '../generated/prisma/client.js';
import { CollectionDto } from './collection.dto.js';
import { CollectionsService } from './collections.service.js';

const createBody = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  groups: ['create'],
});
const updateBody = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  groups: ['update'],
});
const uuid = new ParseUUIDPipe({ version: '4' });

function presentCollection(
  { userId, ...collection }: Collection & { toolCount?: number },
  actorId: string,
) {
  const isOwner = userId === actorId;
  return { ...collection, isOwner, ...(isOwner ? { userId } : {}) };
}

@Controller('api/v1/collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Session() session: UserSession) {
    const collections = await this.collections.list(session.user.id);
    return collections.map((collection) =>
      presentCollection(collection, session.user.id),
    );
  }

  @Post()
  async create(
    @Session() session: UserSession,
    @Body(createBody) dto: CollectionDto,
  ) {
    return presentCollection(
      await this.collections.create(session.user.id, dto),
      session.user.id,
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async findOne(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
  ) {
    return presentCollection(
      await this.collections.findOne(session.user.id, id),
      session.user.id,
    );
  }

  @Patch(':id')
  async update(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
    @Body(updateBody) dto: CollectionDto,
  ) {
    return presentCollection(
      await this.collections.update(session.user.id, id, dto),
      session.user.id,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Session() session: UserSession, @Param('id', uuid) id: string) {
    await this.collections.remove(session.user.id, id);
  }
}

@Controller('api/v1/public-collections')
export class PublicCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Session() session: UserSession) {
    const collections = await this.collections.listPublic();
    return collections.map((collection) =>
      presentCollection(collection, session.user.id),
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async findOne(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
  ) {
    return presentCollection(
      await this.collections.findOne(session.user.id, id, undefined, true),
      session.user.id,
    );
  }
}
