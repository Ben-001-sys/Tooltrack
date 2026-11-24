import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/index.js';

import type { CreateToolDto } from './dto/create-tool.dto.js';
import type { UpdateToolDto } from './dto/update-tool.dto.js';
import { Prisma } from '../generated/prisma/client.js';
import { LinksService } from '../links/index.js';

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

function collectionWebsite(value: string | null) {
  const url = value ? URL.parse(value) : null;
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    return null;
  // These URL components can contain credentials or private tokens.
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
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

  create(userId: string, dto: CreateToolDto) {
    return this.createTool({ userId, collectionId: null }, dto, this.prisma);
  }

  async createForCollection(
    collectionId: string,
    dto: CreateToolDto,
    tx: Prisma.TransactionClient,
  ) {
    return this.presentOwned(
      await this.createTool({ userId: null, collectionId }, dto, tx),
    );
  }

  private async createTool(
    owner:
      | { userId: string; collectionId: null }
      | { userId: null; collectionId: string },
    dto: CreateToolDto,
    db: Prisma.TransactionClient,
  ) {
    if (Boolean(owner.userId) === Boolean(owner.collectionId)) {
      throw new BadRequestException('A tool must have exactly one owner.');
    }
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException('Tool name cannot be empty.');
    }

    await this.checkCategory(dto.categoryId, db);
    await this.checkTags(dto.tagIds ?? [], db);

    try {
      const tool = await db.tool.create({
        data: {
          ...owner,
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

  findManyByIds(userId: string, ids: string[], tx: Prisma.TransactionClient) {
    return tx.tool.findMany({
      where: { userId, id: { in: ids } },
      include,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findCollectionToolSummaries(
    ids: string[],
    tx: Prisma.TransactionClient,
  ) {
    const tools = await tx.tool.findMany({
      where: { id: { in: ids }, userId: { not: null }, collectionId: null },
      select: {
        id: true,
        name: true,
        websiteUrl: true,
        accessType: true,
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return tools.map((tool) => ({
      ...tool,
      websiteUrl: collectionWebsite(tool.websiteUrl),
    }));
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

  update(userId: string, id: string, dto: UpdateToolDto) {
    return this.updateTool({ id, userId }, dto);
  }

  async updateForCollection(
    collectionId: string,
    id: string,
    dto: UpdateToolDto,
    tx: Prisma.TransactionClient,
  ) {
    return this.presentOwned(
      await this.updateTool({ id, collectionId, userId: null }, dto, tx),
    );
  }

  private async updateTool(
    where: Prisma.ToolWhereUniqueInput,
    dto: UpdateToolDto,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const id = where.id;
    if (!id) throw new NotFoundException('Tool not found.');
    if (dto.name !== undefined && !dto.name.trim())
      throw new BadRequestException('Tool name cannot be empty.');
    if (dto.categoryId !== undefined) {
      if (!(await db.tool.findFirst({ where, select: { id: true } })))
        throw new NotFoundException('Tool not found.');
      await this.checkCategory(dto.categoryId, db);
    }
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
          await db.tool.update({ where, data, include: ownerInclude }),
        );
      }
      const replaceTags = async (tx: Prisma.TransactionClient) => {
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
      };
      return tx
        ? await replaceTags(tx)
        : await this.prisma.$transaction(replaceTags);
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

  async findOwnedOne(
    collectionId: string,
    id: string,
    tx: Prisma.TransactionClient,
  ) {
    const tool = await tx.tool.findFirst({
      where: { id, collectionId, userId: null },
      include: ownerInclude,
    });
    if (!tool) throw new NotFoundException('Tool not found.');
    return this.presentOwned(withTags(tool));
  }

  async findOwnedForCollection(
    collectionId: string,
    tx: Prisma.TransactionClient,
  ) {
    const tools = await tx.tool.findMany({
      where: { collectionId, userId: null },
      include: ownerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return tools.map((tool) => this.presentOwned(withTags(tool)));
  }

  async countForCollections(
    collectionIds: string[],
    tx: Prisma.TransactionClient,
  ) {
    const counts = await tx.tool.groupBy({
      by: ['collectionId'],
      where: { collectionId: { in: collectionIds } },
      _count: { _all: true },
    });
    return new Map(counts.map((item) => [item.collectionId, item._count._all]));
  }

  async removeOwned(
    collectionId: string,
    id: string,
    tx: Prisma.TransactionClient,
  ) {
    const result = await tx.tool.deleteMany({
      where: { id, collectionId, userId: null },
    });
    if (!result.count) throw new NotFoundException('Tool not found.');
    await this.links.removeForTool(id, tx);
  }

  removeForCollection(collectionId: string, tx: Prisma.TransactionClient) {
    // ToolTag is internal to Tools and cascades on deletion; shared tags/categories remain.
    return tx.tool.deleteMany({ where: { collectionId, userId: null } });
  }

  private presentOwned(tool: ReturnType<typeof withTags>) {
    return {
      ...tool,
      websiteUrl: collectionWebsite(tool.websiteUrl),
      ownership: 'COLLECTION' as const,
    };
  }

  private async checkCategory(
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (
      !(await db.category.findUnique({
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
