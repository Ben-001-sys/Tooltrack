
import { BadRequestException } from '@nestjs/common';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { PrismaService } from '../prisma/index.js';

import { ToolsService } from './tools.service.js';

describe('ToolsService', () => {
  const prisma = {
    category: {
      findUnique: vi.fn(),
    },
    tool: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };

  const service = new ToolsService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a tool owned by the authenticated user', async () => {
    const categoryId =
      '2d06a387-127e-4213-88ed-fdd7c8cbeec6';

    prisma.category.findUnique.mockResolvedValue({
      id: categoryId,
    });

    prisma.tool.create.mockResolvedValue({
      id: 'tool-001',
      userId: 'user-001',
      name: 'VS Code',
    });

    const result = await service.create(
      'user-001',
      {
        name: 'VS Code',
        description: 'Code editor',
        websiteUrl: 'https://code.visualstudio.com',
        accessType: 'FREE',
        categoryId,
      },
    );

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
    prisma.category.findUnique.mockResolvedValue(
      null,
    );

    await expect(
      service.create('user-001', {
        name: 'Unknown Tool',
        accessType: 'FREE',
        categoryId:
          '2d06a387-127e-4213-88ed-fdd7c8cbeec6',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.tool.create).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name', async () => {
    await expect(
      service.create('user-001', {
        name: '   ',
        accessType: 'FREE',
        categoryId:
          '2d06a387-127e-4213-88ed-fdd7c8cbeec6',
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
});
