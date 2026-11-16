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
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
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

@Controller('api/v1/collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  list(@Session() session: UserSession) {
    return this.collections.list(session.user.id);
  }

  @Post()
  create(
    @Session() session: UserSession,
    @Body(createBody) dto: CollectionDto,
  ) {
    return this.collections.create(session.user.id, dto);
  }

  @Get(':id')
  findOne(@Session() session: UserSession, @Param('id', uuid) id: string) {
    return this.collections.findOne(session.user.id, id);
  }

  @Patch(':id')
  update(
    @Session() session: UserSession,
    @Param('id', uuid) id: string,
    @Body(updateBody) dto: CollectionDto,
  ) {
    return this.collections.update(session.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Session() session: UserSession, @Param('id', uuid) id: string) {
    await this.collections.remove(session.user.id, id);
  }
}
