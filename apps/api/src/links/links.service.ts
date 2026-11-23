import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class LinksService {
  forCollection(collectionId: string, tx: Prisma.TransactionClient) {
    return tx.toolCollectionLink.findMany({
      where: { collectionId },
      select: { toolId: true, addedByUserId: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countForCollections(
    collectionIds: string[],
    tx: Prisma.TransactionClient,
  ) {
    const counts = await tx.toolCollectionLink.groupBy({
      by: ['collectionId'],
      where: { collectionId: { in: collectionIds } },
      _count: { _all: true },
    });
    return new Map(counts.map((item) => [item.collectionId, item._count._all]));
  }

  async add(
    toolId: string,
    collectionId: string,
    addedByUserId: string,
    tx: Prisma.TransactionClient,
  ) {
    try {
      return await tx.toolCollectionLink.create({
        data: { toolId, collectionId, addedByUserId },
        select: { id: true, toolId: true, collectionId: true, createdAt: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This tool is already in the collection.');
      }
      throw error;
    }
  }

  async remove(
    toolId: string,
    collectionId: string,
    tx: Prisma.TransactionClient,
  ) {
    const result = await tx.toolCollectionLink.deleteMany({
      where: { toolId, collectionId },
    });
    if (!result.count)
      throw new NotFoundException('Tool is not in this collection.');
  }

  removeForTool(toolId: string, tx: Prisma.TransactionClient) {
    return tx.toolCollectionLink.deleteMany({ where: { toolId } });
  }

  removeForCollection(collectionId: string, tx: Prisma.TransactionClient) {
    return tx.toolCollectionLink.deleteMany({ where: { collectionId } });
  }
}
