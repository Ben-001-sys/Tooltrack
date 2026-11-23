import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import { LinksService } from '../links/links.service.js';
import type { CollectionDto } from './collection.dto.js';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
  ) {}

  list(userId: string) {
    return this.prisma.collection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listPublic() {
    return this.prisma.$transaction(
      async (tx) => {
        const collections = await tx.collection.findMany({
          where: { visibility: 'PUBLIC' },
          orderBy: { createdAt: 'desc' },
        });
        const counts = await this.links.countForCollections(
          collections.map(({ id }) => id),
          tx,
        );
        return collections.map((collection) => ({
          ...collection,
          toolCount: counts.get(collection.id) ?? 0,
        }));
      },
      // Read visibility and link counts from the same snapshot.
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
      await this.links.removeForCollection(id, tx);
    });
  }

  private accessibleBy(userId: string): Prisma.CollectionWhereInput {
    return { OR: [{ userId }, { visibility: 'PUBLIC' }] };
  }
}
