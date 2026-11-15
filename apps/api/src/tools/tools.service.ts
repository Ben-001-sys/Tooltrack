
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../prisma/index.js';

import type { CreateToolDto } from './dto/create-tool.dto.js';

@Injectable()
export class ToolsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(
    userId: string,
    dto: CreateToolDto,
  ) {
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException(
        'Tool name cannot be empty.',
      );
    }

    const category =
      await this.prisma.category.findUnique({
        where: {
          id: dto.categoryId,
        },
        select: {
          id: true,
        },
      });

    if (!category) {
      throw new BadRequestException(
        'The selected category does not exist.',
      );
    }

    return this.prisma.tool.create({
      data: {
        userId,
        name,
        description:
          dto.description?.trim() || null,
        websiteUrl:
          dto.websiteUrl?.trim() || null,
        accessType: dto.accessType,
        categoryId: category.id,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  async list(userId: string) {
    return this.prisma.tool.findMany({
      where: {
        userId,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  }
}
