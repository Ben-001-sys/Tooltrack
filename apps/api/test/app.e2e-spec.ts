import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const run = promisify(execFile);
const seedDatabase = () =>
  run(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });

describe('compiled API against disposable PostgreSQL', () => {
  let child: ChildProcess;
  let base: string;
  let cookie = '';
  const email = `ci-${crypto.randomUUID()}@example.com`;
  const password = `test-${crypto.randomUUID()}-Aa1!`;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error(
        'TEST_DATABASE_URL must identify a disposable migrated database',
      );
    const socket = createServer().listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['dist/main.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        PORT: String(port),
        BETTER_AUTH_URL: base,
        WEB_ORIGIN: base,
        BETTER_AUTH_SECRET:
          'disposable-ci-auth-secret-with-at-least-32-characters',
      },
      stdio: 'pipe',
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('API exited during startup');
      try {
        if ((await fetch(`${base}/api/v1/health`)).ok) return;
      } catch {
        /* wait for the process to bind */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('API readiness timed out');
  }, 30_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });

  async function post(path: string, body: object, clientIp?: string) {
    const response = await fetch(`${base}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        cookie,
        ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
      },
      body: JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length)
      cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    return response;
  }

  it('reports health and denies anonymous protected access', async () => {
    expect(await (await fetch(`${base}/api/v1/health`)).json()).toMatchObject({
      status: 'ok',
    });
    expect((await fetch(`${base}/api/v1/session`)).status).toBe(401);
  });

  it('registers, persists a session, logs out and logs in', async () => {
    expect(
      (await post('sign-up/email', { email, password, name: 'CI user' })).ok,
    ).toBe(true);
    expect(cookie).not.toBe('');
    const session = await fetch(`${base}/api/v1/session`, {
      headers: { cookie },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      authenticated: true,
      user: { email },
    });
    const revokedCookie = cookie;
    expect((await post('sign-out', {})).ok).toBe(true);
    expect(
      (
        await fetch(`${base}/api/v1/session`, {
          headers: { cookie: revokedCookie },
        })
      ).status,
    ).toBe(401);
    cookie = '';
    expect((await fetch(`${base}/api/v1/session`)).status).toBe(401);
    expect((await post('sign-in/email', { email, password })).ok).toBe(true);
    expect(
      (await fetch(`${base}/api/v1/session`, { headers: { cookie } })).status,
    ).toBe(200);
    const forbidden = await fetch(`${base}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'https://evil.example',
      },
      body: '{}',
    });
    expect(forbidden.status).toBe(403);
    expect((await post('sign-out', {})).ok).toBe(true);
  });

  it('creates/lists tools and enforces ownership, validation and nullable updates across CRUD', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const categories = await prisma.category.createManyAndReturn({
      data: [1, 2].map((index) => ({
        name: `CRUD ${index} ${crypto.randomUUID()}`,
        slug: `crud-${crypto.randomUUID()}`,
      })),
    });
    async function toolRequest(
      method: string,
      path: string,
      body?: object,
      sessionCookie = cookie,
    ) {
      return fetch(`${base}/api/v1/tools${path}`, {
        method,
        headers: {
          cookie: sessionCookie,
          origin: base,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    try {
      expect(
        (
          await post('sign-up/email', {
            email: `owner-${crypto.randomUUID()}@example.com`,
            password,
            name: 'Owner',
          })
        ).ok,
      ).toBe(true);
      const ownerCookie = cookie;
      expect(
        (await fetch(`${base}/api/v1/categories`, { headers: { cookie } }))
          .status,
      ).toBe(200);
      const created = await toolRequest('POST', '', {
        name: ' Original ',
        description: 'Description',
        websiteUrl: 'https://example.com',
        accessType: 'FREE',
        categoryId: categories[0].id,
      });
      expect(created.status).toBe(201);
      const tool = (await created.json()) as { id: string; name: string };
      expect(tool.name).toBe('Original');
      expect(await (await toolRequest('GET', '')).json()).toContainEqual(
        expect.objectContaining({ id: tool.id }),
      );
      expect(
        await (await toolRequest('GET', `/${tool.id}`)).json(),
      ).toMatchObject({ id: tool.id, category: { id: categories[0].id } });

      expect(
        (
          await post('sign-up/email', {
            email: `other-${crypto.randomUUID()}@example.com`,
            password,
            name: 'Other user',
          })
        ).ok,
      ).toBe(true);
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        expect(
          (
            await toolRequest(
              method,
              `/${tool.id}`,
              method === 'PATCH' ? { name: 'Stolen' } : undefined,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await toolRequest(
              method,
              `/${tool.id}`,
              method === 'PATCH' ? { name: 'Stolen' } : undefined,
              '',
            )
          ).status,
        ).toBe(401);
      }
      expect(await (await toolRequest('GET', '')).json()).not.toContainEqual(
        expect.objectContaining({ id: tool.id }),
      );
      cookie = ownerCookie;
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        const body = method === 'PATCH' ? { name: 'Changed' } : undefined;
        expect((await toolRequest(method, '/invalid', body)).status).toBe(400);
        expect(
          (await toolRequest(method, `/${crypto.randomUUID()}`, body)).status,
        ).toBe(404);
      }
      for (const body of [
        { name: ' ' },
        { websiteUrl: 'javascript:alert(1)' },
        { accessType: null },
        { userId: 'other-user' },
        { categoryId: crypto.randomUUID() },
      ]) {
        expect((await toolRequest('PATCH', `/${tool.id}`, body)).status).toBe(
          400,
        );
      }
      const updated = await toolRequest('PATCH', `/${tool.id}`, {
        name: ' Updated ',
        description: null,
        websiteUrl: null,
        accessType: 'LICENSED',
        categoryId: categories[1].id,
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        name: 'Updated',
        description: null,
        websiteUrl: null,
        accessType: 'LICENSED',
        category: { id: categories[1].id },
      });
      const partial = await toolRequest('PATCH', `/${tool.id}`, {
        description: ' New description ',
      });
      expect(await partial.json()).toMatchObject({
        name: 'Updated',
        description: 'New description',
        websiteUrl: null,
      });
      const deleted = await toolRequest('DELETE', `/${tool.id}`);
      expect(deleted.status).toBe(204);
      expect(await deleted.text()).toBe('');
      expect((await toolRequest('GET', `/${tool.id}`)).status).toBe(404);
      expect((await toolRequest('DELETE', `/${tool.id}`)).status).toBe(404);
      expect(await (await toolRequest('GET', '')).json()).not.toContainEqual(
        expect.objectContaining({ id: tool.id }),
      );
    } finally {
      const ids = categories.map((category) => category.id);
      await prisma.tool.deleteMany({ where: { categoryId: { in: ids } } });
      await prisma.category.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    }
  }, 20_000);
  it('isolates collections and tools, validates links, and atomically cleans associations without deleting tools', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const category = await prisma.category.create({
      data: {
        name: `Collections ${crypto.randomUUID()}`,
        slug: crypto.randomUUID(),
      },
    });
    const collectionIds: string[] = [];
    const toolIds: string[] = [];
    async function request(
      method: string,
      path: string,
      body?: object,
      sessionCookie = cookie,
    ) {
      return fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          cookie: sessionCookie,
          origin: base,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    async function create(path: '/collections' | '/tools', body: object) {
      const response = await request('POST', path, body);
      expect(response.status).toBe(201);
      const record = (await response.json()) as {
        id: string;
        name: string;
        description: string | null;
      };
      (path === '/collections' ? collectionIds : toolIds).push(record.id);
      return record;
    }
    try {
      const registered = await post(
        'sign-up/email',
        {
          email: `collections-owner-${crypto.randomUUID()}@example.com`,
          password,
          name: 'Owner',
        },
        '192.0.2.10',
      );
      expect(
        registered.status,
        registered.ok ? undefined : await registered.text(),
      ).toBe(200);
      const owner = cookie;
      const collection = await create('/collections', {
        name: ' Development Stack ',
        description: ' Shared tools ',
      });
      expect(collection).toMatchObject({
        name: 'Development Stack',
        description: 'Shared tools',
      });
      const second = await create('/collections', { name: 'AI Tools' });
      const tool = await create('/tools', {
        name: 'Editor',
        accessType: 'FREE',
        categoryId: category.id,
      });
      const path = `/collections/${collection.id}`;
      expect(
        await (await request('GET', '/collections')).json(),
      ).toContainEqual(expect.objectContaining({ id: collection.id }));
      expect(await (await request('GET', path)).json()).toMatchObject({
        id: collection.id,
      });
      const patch = await request('PATCH', path, {
        name: ' Renamed ',
        description: null,
      });
      expect(patch.status).toBe(200);
      expect(await patch.json()).toMatchObject({
        name: 'Renamed',
        description: null,
      });
      expect(
        await (
          await request('PATCH', path, { description: ' Trimmed ' })
        ).json(),
      ).toMatchObject({ name: 'Renamed', description: 'Trimmed' });
      expect((await request('PATCH', path, {})).status).toBe(200);

      for (const body of [
        {},
        { name: null },
        { name: ' ' },
        { name: 'x'.repeat(121) },
        { name: 'Valid', description: 'x'.repeat(1501) },
        { name: 'Valid', userId: 'attacker' },
      ]) {
        expect((await request('POST', '/collections', body)).status).toBe(400);
      }
      for (const body of [
        { name: null },
        { name: ' ' },
        { description: 5 },
        { id: crypto.randomUUID() },
        { updatedAt: new Date().toISOString() },
      ]) {
        expect((await request('PATCH', path, body)).status).toBe(400);
      }
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        const body = method === 'PATCH' ? { name: 'Changed' } : undefined;
        expect(
          (await request(method, '/collections/invalid', body)).status,
        ).toBe(400);
        expect(
          (await request(method, `/collections/${crypto.randomUUID()}`, body))
            .status,
        ).toBe(404);
        expect((await request(method, path, body, '')).status).toBe(401);
      }
      for (const body of [
        {},
        { toolId: 'invalid' },
        { toolId: tool.id, userId: 'attacker' },
      ]) {
        expect((await request('POST', `${path}/tools`, body)).status).toBe(400);
      }
      expect(
        (
          await request('POST', '/collections/invalid/tools', {
            toolId: tool.id,
          })
        ).status,
      ).toBe(400);
      expect((await request('DELETE', `${path}/tools/invalid`)).status).toBe(
        400,
      );
      expect(
        (
          await request('POST', `${path}/tools`, {
            toolId: crypto.randomUUID(),
          })
        ).status,
      ).toBe(404);

      expect(
        (await request('POST', `${path}/tools`, { toolId: tool.id })).status,
      ).toBe(201);
      expect(
        (await request('POST', `${path}/tools`, { toolId: tool.id })).status,
      ).toBe(409);
      expect(
        (
          await request('POST', `/collections/${second.id}/tools`, {
            toolId: tool.id,
          })
        ).status,
      ).toBe(201);
      expect(
        await prisma.toolCollectionLink.count({ where: { toolId: tool.id } }),
      ).toBe(2);
      expect(await (await request('GET', `${path}/tools`)).json()).toEqual([
        expect.objectContaining({
          id: tool.id,
          category: expect.objectContaining({ id: category.id }),
        }),
      ]);
      const unlinked = await request('DELETE', `${path}/tools/${tool.id}`);
      expect(unlinked.status).toBe(204);
      expect(await unlinked.text()).toBe('');
      expect((await request('DELETE', `${path}/tools/${tool.id}`)).status).toBe(
        404,
      );
      expect((await request('GET', `/tools/${tool.id}`)).status).toBe(200);
      expect(await (await request('GET', `${path}/tools`)).json()).toEqual([]);
      expect(
        (await request('POST', `${path}/tools`, { toolId: tool.id })).status,
      ).toBe(201);

      expect(
        (
          await post(
            'sign-up/email',
            {
              email: `collections-other-${crypto.randomUUID()}@example.com`,
              password,
              name: 'Other',
            },
            '192.0.2.11',
          )
        ).ok,
      ).toBe(true);
      const foreignTool = await create('/tools', {
        name: 'Private',
        accessType: 'FREE',
        categoryId: category.id,
      });
      const foreignCollection = await create('/collections', {
        name: 'Private collection',
      });
      expect(
        await (await request('GET', '/collections')).json(),
      ).not.toContainEqual(expect.objectContaining({ id: collection.id }));
      for (const [method, suffix, body] of [
        ['GET', '', undefined],
        ['PATCH', '', { name: 'Stolen' }],
        ['DELETE', '', undefined],
        ['GET', '/tools', undefined],
        ['POST', '/tools', { toolId: foreignTool.id }],
        ['DELETE', `/tools/${tool.id}`, undefined],
      ] as const) {
        expect((await request(method, `${path}${suffix}`, body)).status).toBe(
          404,
        );
      }
      cookie = owner;
      expect(
        (await request('POST', `${path}/tools`, { toolId: foreignTool.id }))
          .status,
      ).toBe(404);
      expect(
        (await request('DELETE', `${path}/tools/${foreignTool.id}`)).status,
      ).toBe(404);
      expect(
        (
          await request('POST', `/collections/${foreignCollection.id}/tools`, {
            toolId: tool.id,
          })
        ).status,
      ).toBe(404);
      // Even stale or invalid scalar links cannot expose another user's tool.
      await prisma.toolCollectionLink.createMany({
        data: [foreignTool.id, crypto.randomUUID()].map((toolId) => ({
          toolId,
          collectionId: collection.id,
        })),
      });
      expect(await (await request('GET', `${path}/tools`)).json()).toEqual([
        expect.objectContaining({ id: tool.id }),
      ]);

      const deleted = await request('DELETE', path);
      expect(deleted.status).toBe(204);
      expect(await deleted.text()).toBe('');
      expect(
        await prisma.toolCollectionLink.count({
          where: { collectionId: collection.id },
        }),
      ).toBe(0);
      expect((await request('GET', `/tools/${tool.id}`)).status).toBe(200);
      expect((await request('DELETE', `/tools/${tool.id}`)).status).toBe(204);
      expect(
        await prisma.toolCollectionLink.count({ where: { toolId: tool.id } }),
      ).toBe(0);
      expect((await request('GET', `/collections/${second.id}`)).status).toBe(
        200,
      );
      expect(
        await (await request('GET', `/collections/${second.id}/tools`)).json(),
      ).toEqual([]);

      // Both possible request orderings must leave no orphan links after deletion.
      for (const deleteTool of [false, true]) {
        const target = await create('/collections', {
          name: 'Concurrent collection',
        });
        const targetTool = await create('/tools', {
          name: 'Concurrent tool',
          accessType: 'FREE',
          categoryId: category.id,
        });
        const [add, remove] = await Promise.all([
          request('POST', `/collections/${target.id}/tools`, {
            toolId: targetTool.id,
          }),
          request(
            'DELETE',
            deleteTool
              ? `/tools/${targetTool.id}`
              : `/collections/${target.id}`,
          ),
        ]);
        expect([201, 404]).toContain(add.status);
        expect(remove.status).toBe(204);
        expect(
          await prisma.toolCollectionLink.count({
            where: { toolId: targetTool.id, collectionId: target.id },
          }),
        ).toBe(0);
      }
    } finally {
      await prisma.toolCollectionLink.deleteMany({
        where: { collectionId: { in: collectionIds } },
      });
      await prisma.collection.deleteMany({
        where: { id: { in: collectionIds } },
      });
      await prisma.tool.deleteMany({ where: { id: { in: toolIds } } });
      await prisma.category.delete({ where: { id: category.id } });
      await prisma.$disconnect();
    }
  }, 30_000);

  it('migrates an existing tool and category without adding associations', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const migration = (name: string) =>
      readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      );
    const [before, after] = await Promise.all([
      migration('20261113132308_init_tools'),
      migration('20261123130000_add_tool_tags'),
    ]);
    const rollback = new Error('Roll back isolated migration fixture');
    try {
      await expect(
        prisma.$transaction(async (tx) => {
          const schema = `tag_migration_${crypto.randomUUID().replaceAll('-', '')}`;
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          async function apply(sql: string) {
            for (const statement of sql.split(';').map((part) => part.trim())) {
              if (statement) await tx.$executeRawUnsafe(statement);
            }
          }
          await apply(before);
          const toolId = crypto.randomUUID();
          const categoryId = crypto.randomUUID();
          await tx.$executeRaw`
          INSERT INTO categories (id, name, slug, "updatedAt")
          VALUES (${categoryId}::uuid, 'Legacy category', 'legacy-category', now())
        `;
          await tx.$executeRaw`
          INSERT INTO tools (id, "userId", name, "accessType", "categoryId", "updatedAt")
          VALUES (${toolId}::uuid, 'legacy-owner', 'Legacy tool', 'FREE', ${categoryId}::uuid, now())
        `;
          await apply(after);
          expect(
            await tx.$queryRaw`
          SELECT t.id, t."userId", c.name AS category, l."tagId"
          FROM tools t JOIN categories c ON t."categoryId" = c.id
          LEFT JOIN tool_tags l ON l."toolId" = t.id
          WHERE t.id = ${toolId}::uuid
        `,
          ).toEqual([
            {
              id: toolId,
              userId: 'legacy-owner',
              category: 'Legacy category',
              tagId: null,
            },
          ]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('seeds all CETECH departments and default categories idempotently', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const tags = () =>
      prisma.tag.findMany({
        where: { slug: { startsWith: 'cetech-' } },
        orderBy: { slug: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          kind: true,
          isSystem: true,
        },
      });
    try {
      await seedDatabase();
      const first = await tags();
      await seedDatabase();
      expect(await tags()).toEqual(first);
      expect(first).toHaveLength(18);
      expect(first.map(({ name }) => name).sort()).toEqual(
        [
          'Finance, Accounting & Credit Control',
          'Marketing, E-Commerce & Business Development',
          'Sales & Commercial Operations',
          'Sourcing & Procurement',
          'Operations',
          'Production',
          'Delivery & Logistics',
          'Customer Experience & Support (CES)',
          'Human Resources',
          'Quality Management',
          'Research & Development',
          'Legal & Public Relations',
          'Inventory, Fulfillment & Warehouse Management',
          'Security & Loss Prevention',
          'Information Technology (IT) & Digital Systems',
          'Executive Management',
          'Administration & Facilities Management',
          'Product Management & Merchandising',
        ]
          .map((name) => `${name} - CETECH`)
          .sort(),
      );
      expect(
        first.every((tag) => tag.isSystem && tag.kind === 'DEPARTMENT'),
      ).toBe(true);
      expect(
        await prisma.category.findMany({
          select: { slug: true },
          orderBy: { slug: 'asc' },
        }),
      ).toEqual(
        [
          'ai',
          'business',
          'communication',
          'design',
          'development',
          'e-commerce',
          'other',
          'productivity',
        ].map((slug) => ({ slug })),
      );
      await expect(
        prisma.tag.create({
          data: {
            name: first[0].name.toLowerCase(),
            slug: 'ambiguous-name',
            kind: 'GENERAL',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await prisma.$disconnect();
    }
  }, 20_000);

  it('validates, reads and replaces owner tags atomically while preserving collection links', async () => {
    await seedDatabase();
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const category = await prisma.category.findUniqueOrThrow({
      where: { slug: 'productivity' },
    });
    const emails: string[] = [];
    const name = `Tagged tool ${crypto.randomUUID()}`;
    const toolIds: string[] = [];
    let collectionId: string | undefined;
    function request(
      method: string,
      path: string,
      body?: object,
      actor = cookie,
    ) {
      return fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          cookie: actor,
          origin: base,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    async function register(ip: string) {
      cookie = '';
      const email = `tags-${crypto.randomUUID()}@example.com`;
      emails.push(email);
      expect(
        (
          await post(
            'sign-up/email',
            { email, password, name: 'Tag tester' },
            ip,
          )
        ).status,
      ).toBe(200);
      return cookie;
    }
    async function createTool(body: object) {
      const response = await request('POST', '/tools', body);
      expect(response.status).toBe(201);
      const tool = (await response.json()) as {
        id: string;
        tags: { id: string }[];
      };
      toolIds.push(tool.id);
      return tool;
    }
    try {
      const owner = await register('192.0.2.40');
      expect((await request('GET', '/tags', undefined, '')).status).toBe(401);
      const response = await request('GET', '/tags');
      expect(response.status).toBe(200);
      const catalog = (await response.json()) as {
        id: string;
        name: string;
        slug: string;
        kind: string;
      }[];
      expect(catalog).toHaveLength(18);
      expect(catalog.map((tag) => tag.name)).toEqual(
        catalog.map((tag) => tag.name).sort(),
      );
      const [first, second, third] = catalog;
      expect(first).toEqual({
        id: expect.any(String),
        name: expect.any(String),
        slug: expect.any(String),
        kind: 'DEPARTMENT',
      });

      const fields = { name, accessType: 'FREE', categoryId: category.id };
      expect((await createTool(fields)).tags).toEqual([]);
      const ids = [first.id, second.id];
      const tool = await createTool({ ...fields, tagIds: ids });
      expect(tool.tags).toEqual([first, second]);
      const path = `/tools/${tool.id}`;
      expect(await (await request('GET', '/tools')).json()).toContainEqual(
        expect.objectContaining({ id: tool.id, tags: [first, second] }),
      );
      expect(await (await request('GET', path)).json()).toMatchObject({
        tags: [first, second],
      });
      await expect(
        prisma.toolTag.create({
          data: { toolId: tool.id, tagId: first.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      for (const tagIds of [
        null,
        first.id,
        ['invalid'],
        [first.id, first.id.toUpperCase()],
        Array.from({ length: 51 }, () => crypto.randomUUID()),
        [first.id, crypto.randomUUID()],
      ]) {
        expect(
          (await request('POST', '/tools', { ...fields, tagIds })).status,
        ).toBe(400);
        expect(
          (await request('PATCH', path, { tagIds, name: 'Must roll back' }))
            .status,
        ).toBe(400);
      }
      expect(await prisma.tool.count({ where: { name } })).toBe(2);
      expect(await (await request('GET', path)).json()).toMatchObject({
        name,
        tags: [first, second],
      });

      const collaborator = await register('192.0.2.41');
      expect(
        (await request('PATCH', path, { tagIds: [third.id] }, collaborator))
          .status,
      ).toBe(404);
      expect((await request('GET', path)).status).toBe(404);
      cookie = owner;
      for (const [body, tags] of [
        [{ description: 'Preserve selections' }, [first, second]],
        [{ tagIds: [...ids, third.id] }, [first, second, third]],
        [{ tagIds: [second.id, third.id] }, [second, third]],
        [{ tagIds: [] }, []],
      ] as const) {
        const updated = await request('PATCH', path, body);
        expect(updated.status).toBe(200);
        expect(await updated.json()).toMatchObject({ tags });
      }

      const replacements = [[first], [second, third]];
      const updates = await Promise.all(
        replacements.map((tags) =>
          request('PATCH', path, { tagIds: tags.map(({ id }) => id) }),
        ),
      );
      for (const [index, updated] of updates.entries()) {
        expect(updated.status).toBe(200);
        expect(await updated.json()).toMatchObject({
          tags: replacements[index],
        });
      }
      const current = (await (await request('GET', path)).json()) as {
        tags: unknown;
      };
      expect(replacements).toContainEqual(current.tags);

      const collection = await request('POST', '/collections', {
        name: 'Tag privacy fixture',
      });
      expect(collection.status).toBe(201);
      collectionId = ((await collection.json()) as { id: string }).id;
      const linked = `/collections/${collectionId}/tools`;
      expect((await request('POST', linked, { toolId: tool.id })).status).toBe(
        201,
      );
      const [summary] = (await (
        await request('GET', linked)
      ).json()) as unknown[];
      expect(summary).toMatchObject({ id: tool.id });
      expect(summary).not.toHaveProperty('tags');
      expect((await request('DELETE', path)).status).toBe(204);
      expect(await prisma.toolTag.count({ where: { toolId: tool.id } })).toBe(
        0,
      );
      expect(
        await prisma.tag.count({ where: { id: { in: [...ids, third.id] } } }),
      ).toBe(3);
      expect(
        await prisma.toolCollectionLink.count({ where: { toolId: tool.id } }),
      ).toBe(0);
    } finally {
      if (collectionId) {
        await prisma.toolCollectionLink.deleteMany({ where: { collectionId } });
        await prisma.collection.deleteMany({ where: { id: collectionId } });
      }
      await prisma.tool.deleteMany({ where: { id: { in: toolIds } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await prisma.$disconnect();
    }
  }, 30_000);
});
