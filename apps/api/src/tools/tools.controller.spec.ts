
import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { ToolsController } from './tools.controller.js';
import { ToolsService } from './tools.service.js';

describe('ToolsController', () => {
  let controller: ToolsController;

  const mockToolsService = {
    create: vi.fn(),
    list: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [ToolsController],
        providers: [
          {
            provide: ToolsService,
            useValue: mockToolsService,
          },
        ],
      }).compile();

    controller = module.get<ToolsController>(
      ToolsController,
    );
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
      session as Parameters<
        ToolsController['findAll']
      >[0],
    );

    expect(mockToolsService.list).toHaveBeenCalledWith(
      'user-001',
    );

    expect(result).toEqual(tools);
  });

  it('should create a tool for the authenticated user', async () => {
    const dto = {
      name: 'VS Code',
      description: 'Code editor',
      websiteUrl: 'https://code.visualstudio.com',
      accessType: 'FREE' as const,
      categoryId:
        '2d06a387-127e-4213-88ed-fdd7c8cbeec6',
    };

    const createdTool = {
      id: 'tool-001',
      userId: 'user-001',
      ...dto,
    };

    mockToolsService.create.mockResolvedValue(
      createdTool,
    );

    const session = {
      user: {
        id: 'user-001',
      },
    };

    const result = await controller.create(
      session as Parameters<
        ToolsController['create']
      >[0],
      dto,
    );

    expect(mockToolsService.create).toHaveBeenCalledWith(
      'user-001',
      dto,
    );

    expect(result).toEqual(createdTool);
  });
});
