import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import { LinksService } from '../links/index.js';
import { ToolsService } from '../tools/index.js';
import type { CollectionDto } from './collection.dto.js';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
    private readonly tools: ToolsService,
  ) {}

  list(userId: string) {
    return this.listWhere({ userId });
  }

  listPublic() {
    return this.listWhere({ visibility: 'PUBLIC' });
  }

  private listWhere(where: Prisma.CollectionWhereInput) {
    return this.prisma.$transaction(
      async (tx) => {
        const collections = await tx.collection.findMany({
          where,
          orderBy: { createdAt: 'desc' },
        });
        const ids = collections.map(({ id }) => id);
        const linked = await this.links.countForCollections(ids, tx);
        const owned = await this.tools.countForCollections(ids, tx);
        return collections.map((collection) => ({
          ...collection,
          toolCount:
            (linked.get(collection.id) ?? 0) + (owned.get(collection.id) ?? 0),
        }));
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  create(userId: string, dto: CollectionDto) {
    return this.prisma.collection.create({
      data: {
        userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        visibility: dto.visibility,
      },
    });
  }

  async findOne(
    userId: string,
    id: string,
    tx?: Prisma.TransactionClient,
    publicOnly = false,
  ) {
    if (tx) {
      // Serialize linked reads and mutations with visibility changes and deletion.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM collections WHERE id = ${id}::uuid FOR SHARE
      `;
      if (!rows.length) throw new NotFoundException('Collection not found.');
    }
    const collection = await (tx ?? this.prisma).collection.findFirst({
      where: {
        id,
        ...(publicOnly ? { visibility: 'PUBLIC' } : this.accessibleBy(userId)),
      },
    });
    if (!collection) throw new NotFoundException('Collection not found.');
    return collection;
  }

  async update(userId: string, id: string, dto: Partial<CollectionDto>) {
    const [collection] = await this.prisma.collection.updateManyAndReturn({
      where: {
        id,
        ...(dto.visibility === undefined
          ? this.accessibleBy(userId)
          : { userId }),
      },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description?.trim() || null,
        visibility: dto.visibility,
      },
    });
    if (!collection) {
      if (dto.visibility !== undefined) {
        await this.findOne(userId, id);
        throw new ForbiddenException(
          'Only the collection owner can change visibility.',
        );
      }
      throw new NotFoundException('Collection not found.');
    }
    return collection;
  }

  remove(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.collection.deleteMany({
        where: { id, ...this.accessibleBy(userId) },
      });
      if (!result.count) throw new NotFoundException('Collection not found.');
      await this.tools.removeForCollection(id, tx);
      await this.links.removeForCollection(id, tx);
    });
  }

  private accessibleBy(userId: string): Prisma.CollectionWhereInput {
    return { OR: [{ userId }, { visibility: 'PUBLIC' }] };
  }
}
