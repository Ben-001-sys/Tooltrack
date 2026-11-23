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

const tagSelect = { id: true, name: true, slug: true, kind: true } as const;
const ownerInclude = {
  ...include,
  toolTags: {
    select: { tag: { select: tagSelect } },
    orderBy: { tag: { name: 'asc' } },
  },
} as const;

function withTags(
  tool: Prisma.ToolGetPayload<{ include: typeof ownerInclude }>,
) {
  const { toolTags, ...record } = tool;
  return { ...record, tags: toolTags.map(({ tag }) => tag) };
}

function invalidReference(error: unknown, tagIds?: string[]): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  ) {
    throw new BadRequestException(
      tagIds?.length
        ? 'The selected category or one of the selected tags no longer exists.'
        : 'The selected category does not exist.',
    );
  }
  throw error;
}

@Injectable()
export class ToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
  ) {}

  listTags() {
    return this.prisma.tag.findMany({
      select: tagSelect,
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, dto: CreateToolDto) {
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException('Tool name cannot be empty.');
    }

    await this.checkCategory(dto.categoryId);
    await this.checkTags(dto.tagIds ?? [], this.prisma);

    try {
      const tool = await this.prisma.tool.create({
        data: {
          userId,
          name,
          description: dto.description?.trim() || null,
          websiteUrl: dto.websiteUrl?.trim() || null,
          accessType: dto.accessType,
          categoryId: dto.categoryId,
          toolTags: dto.tagIds?.length
            ? { create: dto.tagIds.map((tagId) => ({ tagId })) }
            : undefined,
        },
        include: ownerInclude,
      });
      return withTags(tool);
    } catch (error) {
      return invalidReference(error, dto.tagIds);
    }
  }

  async list(userId: string) {
    const tools = await this.prisma.tool.findMany({
      where: {
        userId,
      },
      include: ownerInclude,
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
    return tools.map(withTags);
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
      include: ownerInclude,
    });
    if (!tool) throw new NotFoundException('Tool not found.');
    return withTags(tool);
  }

  async update(userId: string, id: string, dto: UpdateToolDto) {
    if (dto.name !== undefined && !dto.name.trim())
      throw new BadRequestException('Tool name cannot be empty.');
    if (dto.categoryId !== undefined) {
      await this.findOne(userId, id);
      await this.checkCategory(dto.categoryId);
    }
    const where = { id, userId };
    const data = {
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
    };
    const { tagIds } = dto;
    try {
      if (tagIds === undefined) {
        return withTags(
          await this.prisma.tool.update({ where, data, include: ownerInclude }),
        );
      }
      return await this.prisma.$transaction(async (tx) => {
        // The parent update serializes concurrent replacements and checks ownership.
        await tx.tool.update({
          where,
          data: { ...data, updatedAt: new Date() },
          select: { id: true },
        });
        await this.checkTags(tagIds, tx);
        await tx.toolTag.deleteMany({ where: { toolId: id } });
        if (tagIds.length)
          await tx.toolTag.createMany({
            data: tagIds.map((tagId) => ({ toolId: id, tagId })),
          });
        return withTags(
          await tx.tool.findUniqueOrThrow({
            where: { id },
            include: ownerInclude,
          }),
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Tool not found.');
      }
      return invalidReference(error, tagIds);
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

  private async checkTags(ids: string[], db: Prisma.TransactionClient) {
    if (
      ids.length &&
      (await db.tag.count({ where: { id: { in: ids } } })) !== ids.length
    ) {
      throw new BadRequestException('One or more selected tags do not exist.');
    }
  }
}
