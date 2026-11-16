import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/index.js';

import type { CreateToolDto } from './dto/create-tool.dto.js';
import type { UpdateToolDto } from './dto/update-tool.dto.js';
import { Prisma } from '../generated/prisma/client.js';
import { LinksService } from '../links/links.service.js';

const include = {
  category: { select: { id: true, name: true, slug: true } },
} as const;

@Injectable()
export class ToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
  ) {}

  async create(userId: string, dto: CreateToolDto) {
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException('Tool name cannot be empty.');
    }

    await this.checkCategory(dto.categoryId);

    return this.prisma.tool.create({
      data: {
        userId,
        name,
        description: dto.description?.trim() || null,
        websiteUrl: dto.websiteUrl?.trim() || null,
        accessType: dto.accessType,
        categoryId: dto.categoryId,
      },
      include,
    });
  }

  async list(userId: string) {
    return this.prisma.tool.findMany({
      where: {
        userId,
      },
      include,
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  }

  findManyByIds(userId: string, ids: string[]) {
    return this.prisma.tool.findMany({
      where: { userId, id: { in: ids } },
      include,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string, tx?: Prisma.TransactionClient) {
    if (tx)
      await tx.$queryRaw`SELECT id FROM tools WHERE id = ${id}::uuid AND "userId" = ${userId} FOR SHARE`;
    const tool = await (tx ?? this.prisma).tool.findFirst({
      where: { id, userId },
      include,
    });
    if (!tool) throw new NotFoundException('Tool not found.');
    return tool;
  }

  async update(userId: string, id: string, dto: UpdateToolDto) {
    if (dto.name !== undefined && !dto.name.trim())
      throw new BadRequestException('Tool name cannot be empty.');
    if (dto.categoryId !== undefined) {
      await this.findOne(userId, id);
      await this.checkCategory(dto.categoryId);
    }
    try {
      return await this.prisma.tool.update({
        where: { id, userId },
        data: {
          name: dto.name?.trim(),
          description:
            dto.description === undefined
              ? undefined
              : dto.description?.trim() || null,
          websiteUrl:
            dto.websiteUrl === undefined
              ? undefined
              : dto.websiteUrl?.trim() || null,
          accessType: dto.accessType,
          categoryId: dto.categoryId,
        },
        include,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Tool not found.');
        if (error.code === 'P2003')
          throw new BadRequestException(
            'The selected category does not exist.',
          );
      }
      throw error;
    }
  }

  async remove(userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.tool.deleteMany({ where: { id, userId } });
      if (!result.count) throw new NotFoundException('Tool not found.');
      await this.links.removeForTool(id, tx);
    });
  }

  private async checkCategory(id: string) {
    if (
      !(await this.prisma.category.findUnique({
        where: { id },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException('The selected category does not exist.');
    }
  }
}
