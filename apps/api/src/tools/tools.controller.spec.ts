import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { ToolsController } from './tools.controller.js';
import { ToolsService } from './tools.service.js';
import {
  BadRequestException,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import { UpdateToolDto } from './dto/update-tool.dto.js';

describe('ToolsController', () => {
  let controller: ToolsController;

  const mockToolsService = {
    create: vi.fn(),
    list: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ToolsController],
      providers: [
        {
          provide: ToolsService,
          useValue: mockToolsService,
        },
      ],
    }).compile();

    controller = module.get<ToolsController>(ToolsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should list tools belonging to the authenticated user', async () => {
    const tools = [
      {
        id: 'tool-001',
        userId: 'user-001',
        name: 'VS Code',
      },
    ];

    mockToolsService.list.mockResolvedValue(tools);

    const session = {
      user: {
        id: 'user-001',
      },
    };

    const result = await controller.findAll(
      session as Parameters<ToolsController['findAll']>[0],
    );

    expect(mockToolsService.list).toHaveBeenCalledWith('user-001');

    expect(result).toEqual(tools);
  });

  it('should create a tool for the authenticated user', async () => {
    const dto = {
      name: 'VS Code',
      description: 'Code editor',
      websiteUrl: 'https://code.visualstudio.com',
      accessType: 'FREE' as const,
      categoryId: '2d06a387-127e-4213-88ed-fdd7c8cbeec6',
    };

    const createdTool = {
      id: 'tool-001',
      userId: 'user-001',
      ...dto,
    };

    mockToolsService.create.mockResolvedValue(createdTool);

    const session = {
      user: {
        id: 'user-001',
      },
    };

    const result = await controller.create(
      session as Parameters<ToolsController['create']>[0],
      dto,
    );

    expect(mockToolsService.create).toHaveBeenCalledWith('user-001', dto);

    expect(result).toEqual(createdTool);
  });

  it('passes only the authenticated owner to read, update and delete', async () => {
    const session = { user: { id: 'owner' } } as Parameters<
      ToolsController['findOne']
    >[0];
    const id = crypto.randomUUID();
    await controller.findOne(session, id);
    await controller.update(session, id, { description: null });
    await controller.remove(session, id);
    expect(mockToolsService.findOne).toHaveBeenCalledWith('owner', id);
    expect(mockToolsService.update).toHaveBeenCalledWith('owner', id, {
      description: null,
    });
    expect(mockToolsService.remove).toHaveBeenCalledWith('owner', id);
  });

  it('trims PATCH fields, supports null clearing, and rejects invalid or protected properties', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata = { type: 'body' as const, metatype: UpdateToolDto };
    expect(
      await pipe.transform(
        {
          name: ' Editor ',
          description: null,
          websiteUrl: ' https://example.com ',
          accessType: ' FREE ',
        },
        metadata,
      ),
    ).toMatchObject({
      name: 'Editor',
      description: null,
      websiteUrl: 'https://example.com',
      accessType: 'FREE',
    });
    expect(await pipe.transform({ websiteUrl: null }, metadata)).toMatchObject({
      websiteUrl: null,
    });
    await pipe.transform({}, metadata);
    for (const value of [
      { name: ' ' },
      { name: null },
      { name: 'x'.repeat(121) },
      { description: 'x'.repeat(1501) },
      { websiteUrl: 'javascript:alert(1)' },
      { websiteUrl: 'ftp://example.com' },
      { websiteUrl: 'https://example.com/' + 'x'.repeat(2048) },
      { accessType: 'PAID' },
      { accessType: null },
      { categoryId: 'invalid' },
      { categoryId: null },
      { id: crypto.randomUUID() },
      { userId: 'attacker' },
      { createdAt: new Date().toISOString() },
      { updatedAt: new Date().toISOString() },
      { unexpected: true },
    ]) {
      await expect(pipe.transform(value, metadata)).rejects.toThrow(
        BadRequestException,
      );
    }
    await expect(
      new ParseUUIDPipe({ version: '4' }).transform('invalid', {
        type: 'param',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
