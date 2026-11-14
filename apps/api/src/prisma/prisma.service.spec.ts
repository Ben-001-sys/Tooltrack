import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://unit:unit@127.0.0.1:1/unit');
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects missing configuration before connecting', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => new PrismaService()).toThrow('DATABASE_URL is not configured');
  });

  it('connects and verifies a query on startup, then disconnects on shutdown', async () => {
    const connect = vi.spyOn(service, '$connect').mockResolvedValue();
    const query = vi.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();
    await service.onModuleInit();
    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('propagates database failures so startup cannot appear healthy', async () => {
    vi.spyOn(service, '$connect').mockRejectedValue(new Error('database unavailable'));
    await expect(service.onModuleInit()).rejects.toThrow('database unavailable');
  });
});
