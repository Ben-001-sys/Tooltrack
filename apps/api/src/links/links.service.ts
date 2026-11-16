import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';

@Injectable()
export class LinksService {
  constructor(private readonly prisma: PrismaService) {}

  async toolIds(collectionId: string) {
    const links = await this.prisma.toolCollectionLink.findMany({
      where: { collectionId },
      select: { toolId: true },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((link) => link.toolId);
  }

  async add(
    toolId: string,
    collectionId: string,
    tx: Prisma.TransactionClient,
  ) {
    try {
      return await tx.toolCollectionLink.create({
        data: { toolId, collectionId },
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
