import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/index.js';

import type { CreateToolDto } from './dto/create-tool.dto.js';
import type { UpdateToolDto } from './dto/update-tool.dto.js';
import { Prisma } from '../generated/prisma/client.js';

const include = {
  category: { select: { id: true, name: true, slug: true } },
} as const;

@Injectable()
export class ToolsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findOne(userId: string, id: string) {
    const tool = await this.prisma.tool.findFirst({
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
    const result = await this.prisma.tool.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Tool not found.');
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
