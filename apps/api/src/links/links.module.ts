import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/index.js';
import { LinksService } from './links.service.js';

@Module({
  imports: [PrismaModule],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
