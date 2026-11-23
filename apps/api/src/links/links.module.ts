import { Module } from '@nestjs/common';
import { LinksService } from './links.service.js';

@Module({
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
