import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/index.js';

import { ToolsService } from './tools.service.js';
import type { LinksService } from '../links/links.service.js';

describe('ToolsService', () => {
  const prisma = {
    $transaction: vi.fn(),
    category: {
      findUnique: vi.fn(),
    },
    tool: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  const links = { removeForTool: vi.fn() };
  const service = new ToolsService(
    prisma as unknown as PrismaService,
    links as unknown as LinksService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof prisma) => Promise<unknown>) => operation(prisma),
    );
  });

  it('creates a tool owned by the authenticated user', async () => {
    const categoryId = '2d06a387-127e-4213-88ed-fdd7c8cbeec6';

    prisma.category.findUnique.mockResolvedValue({
      id: categoryId,
    });

    prisma.tool.create.mockResolvedValue({
      id: 'tool-001',
      userId: 'user-001',
      name: 'VS Code',
    });

    const result = await service.create('user-001', {
      name: 'VS Code',
      description: 'Code editor',
      websiteUrl: 'https://code.visualstudio.com',
      accessType: 'FREE',
      categoryId,
    });

    expect(prisma.tool.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-001',
          name: 'VS Code',
          accessType: 'FREE',
          categoryId,
        }),
      }),
    );

    expect(result.userId).toBe('user-001');
  });

  it('rejects a missing category', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(
      service.create('user-001', {
        name: 'Unknown Tool',
        accessType: 'FREE',
        categoryId: '2d06a387-127e-4213-88ed-fdd7c8cbeec6',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.tool.create).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name', async () => {
    await expect(
      service.create('user-001', {
        name: '   ',
        accessType: 'FREE',
        categoryId: '2d06a387-127e-4213-88ed-fdd7c8cbeec6',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.tool.create).not.toHaveBeenCalled();
  });

  it('restricts listing to the authenticated user', async () => {
    prisma.tool.findMany.mockResolvedValue([]);

    await service.list('user-002');

    expect(prisma.tool.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-002',
        },
      }),
    );
  });

  it('reads, updates and deletes using both the tool ID and session owner', async () => {
    const tool = {
      id: 'tool-001',
      userId: 'user-001',
      category: { name: 'Design' },
    };
    prisma.tool.findFirst.mockResolvedValue(tool);
    prisma.tool.update.mockResolvedValue(tool);
    prisma.tool.deleteMany.mockResolvedValue({ count: 1 });
    expect(await service.findOne('user-001', tool.id)).toEqual(tool);
    expect(
      await service.update('user-001', tool.id, {
        name: ' Updated ',
        description: null,
        websiteUrl: null,
      }),
    ).toEqual(tool);
    await service.remove('user-001', tool.id);
    for (const query of [
      prisma.tool.findFirst,
      prisma.tool.update,
      prisma.tool.deleteMany,
    ]) {
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: tool.id, userId: 'user-001' } }),
      );
    }
    expect(prisma.tool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Updated',
          description: null,
          websiteUrl: null,
        }),
        include: { category: { select: { id: true, name: true, slug: true } } },
      }),
    );
  });

  it('returns the same 404 for missing or foreign tools and never changes their category', async () => {
    prisma.tool.findFirst.mockResolvedValue(null);
    prisma.tool.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: '7.10.1',
      }),
    );
    prisma.tool.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.findOne('other-user', 'tool-001')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.update('other-user', 'tool-001', { name: 'Changed' }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.remove('other-user', 'tool-001')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.update('other-user', 'tool-001', {
        categoryId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
  });

  it('validates category changes and propagates unexpected database failures', async () => {
    prisma.tool.findFirst.mockResolvedValue({ id: 'tool-001' });
    prisma.category.findUnique.mockResolvedValue(null);
    await expect(
      service.update('user-001', 'tool-001', {
        categoryId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.tool.update).not.toHaveBeenCalled();
    prisma.tool.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('category removed', {
        code: 'P2003',
        clientVersion: '7.10.1',
      }),
    );
    await expect(
      service.update('user-001', 'tool-001', { name: 'Updated' }),
    ).rejects.toThrow(BadRequestException);
    prisma.tool.update.mockRejectedValue(new Error('database unavailable'));
    await expect(service.update('user-001', 'tool-001', {})).rejects.toThrow(
      'database unavailable',
    );
  });
});
