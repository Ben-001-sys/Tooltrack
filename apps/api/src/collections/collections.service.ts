import { Injectable, NotFoundException } from '@nestjs/common';
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

  create(userId: string, dto: CollectionDto) {
    return this.prisma.collection.create({
      data: {
        userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
      },
    });
  }

  async findOne(userId: string, id: string, tx?: Prisma.TransactionClient) {
    // Link writes hold a shared row lock until commit, so deletion cannot leave an orphan.
    if (tx)
      await tx.$queryRaw`SELECT id FROM collections WHERE id = ${id}::uuid AND "userId" = ${userId} FOR SHARE`;
    const collection = await (tx ?? this.prisma).collection.findFirst({
      where: { id, userId },
    });
    if (!collection) throw new NotFoundException('Collection not found.');
    return collection;
  }

  async update(userId: string, id: string, dto: Partial<CollectionDto>) {
    const [collection] = await this.prisma.collection.updateManyAndReturn({
      where: { id, userId },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description?.trim() || null,
      },
    });
    if (!collection) throw new NotFoundException('Collection not found.');
    return collection;
  }

  remove(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.collection.deleteMany({ where: { id, userId } });
      if (!result.count) throw new NotFoundException('Collection not found.');
      await this.links.removeForCollection(id, tx);
    });
  }
}
