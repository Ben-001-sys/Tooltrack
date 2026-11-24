import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

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
        visibility: 'PRIVATE',
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

  it('preserves existing collections and links when migrating visibility', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const rollback = new Error('Roll back isolated migration fixture');
    const migration = (name: string) =>
      readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      );
    const [before, after] = await Promise.all([
      migration('20261116133000_add_collections_and_tool_links'),
      migration('20261123120000_add_collection_visibility'),
    ]);
    try {
      await expect(
        prisma.$transaction(async (tx) => {
          const schema = `migration_${crypto.randomUUID().replaceAll('-', '')}`;
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          const apply = async (sql: string) => {
            for (const statement of sql.split(';').map((part) => part.trim())) {
              if (statement) await tx.$executeRawUnsafe(statement);
            }
          };
          await apply(before);
          const id = crypto.randomUUID();
          const toolId = crypto.randomUUID();
          await tx.$executeRaw`
            INSERT INTO collections (id, "userId", name, "updatedAt")
            VALUES (${id}::uuid, 'legacy-owner', 'Legacy collection', now())
          `;
          await tx.$executeRaw`
            INSERT INTO tool_collection_links (id, "collectionId", "toolId")
            VALUES (${crypto.randomUUID()}::uuid, ${id}::uuid, ${toolId}::uuid)
          `;
          await apply(after);
          expect(
            await tx.$queryRaw`
            SELECT c.name, c."userId", c.visibility::text, l."toolId", l."addedByUserId"
            FROM collections c JOIN tool_collection_links l ON l."collectionId" = c.id
            WHERE c.id = ${id}::uuid
          `,
          ).toEqual([
            {
              name: 'Legacy collection',
              userId: 'legacy-owner',
              visibility: 'PRIVATE',
              toolId,
              addedByUserId: null,
            },
          ]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('lets three signed-in users collaborate on public collections without sharing Tool ownership', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const category = await prisma.category.create({
      data: {
        name: `Collaboration ${crypto.randomUUID()}`,
        slug: crypto.randomUUID(),
      },
    });
    const users: string[] = [];
    const emails: string[] = [];
    const collections: string[] = [];
    const discovery = '/public-collections';
    function request(
      actor: string,
      method: string,
      path: string,
      body?: object,
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
    async function create(actor: string, path: string, data: object) {
      const response = await request(actor, 'POST', path, data);
      expect(response.status).toBe(201);
      const record = (await response.json()) as { id: string };
      if (path === '/collections') collections.push(record.id);
      return record;
    }
    try {
      for (const [index, name] of [
        'Emmanuel',
        'Benjamin',
        'Contributor',
      ].entries()) {
        cookie = '';
        const email = `collaborator-${crypto.randomUUID()}@example.com`;
        emails.push(email);
        const registration = await post(
          'sign-up/email',
          { email, password, name },
          `192.0.2.${20 + index}`,
        );
        expect(registration.status).toBe(200);
        users.push(cookie);
      }
      const [owner, collaborator, contributor] = users;
      const saved = await Promise.all(
        users.map((actor, index) =>
          create(actor, '/tools', {
            name: ['Terminal', 'VS Code', 'Docker'][index],
            description: 'Private notes',
            websiteUrl: 'https://example.com/tool?token=private#notes',
            accessType: 'FREE',
            categoryId: category.id,
          }),
        ),
      );
      const collection = await create(owner, '/collections', {
        name: 'Development Tools',
      });
      const path = `/collections/${collection.id}`;
      const publicPath = `${discovery}/${collection.id}`;
      const linkPath = `${path}/tools`;

      for (const route of [discovery, publicPath, `${publicPath}/tools`]) {
        expect((await request('', 'GET', route)).status).toBe(401);
      }
      expect(await (await request(owner, 'GET', path)).json()).toMatchObject({
        visibility: 'PRIVATE',
        isOwner: true,
      });
      expect(
        await (await request(collaborator, 'GET', discovery)).json(),
      ).not.toContainEqual(expect.objectContaining({ id: collection.id }));
      expect((await request(owner, 'GET', publicPath)).status).toBe(404);
      expect((await request(owner, 'GET', `${publicPath}/tools`)).status).toBe(
        404,
      );
      for (const visibility of [null, 'public', 'SHARED', 1]) {
        expect(
          (await request(owner, 'PATCH', path, { visibility })).status,
        ).toBe(400);
        expect(
          (
            await request(owner, 'POST', '/collections', {
              name: 'Invalid',
              visibility,
            })
          ).status,
        ).toBe(400);
      }
      expect(
        (await request(owner, 'PATCH', path, { visibility: 'PUBLIC' })).status,
      ).toBe(200);
      expect(
        await (await request(collaborator, 'GET', '/collections')).json(),
      ).toEqual([]);
      expect(
        await (await request(collaborator, 'GET', discovery)).json(),
      ).toContainEqual(
        expect.objectContaining({
          id: collection.id,
          visibility: 'PUBLIC',
          isOwner: false,
          toolCount: 0,
        }),
      );
      for (const route of [path, publicPath]) {
        const response = await request(collaborator, 'GET', route);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        const body: unknown = await response.json();
        expect(body).toMatchObject({
          id: collection.id,
          visibility: 'PUBLIC',
          isOwner: false,
        });
        expect(body).not.toHaveProperty('userId');
      }
      expect(
        (
          await request(collaborator, 'PATCH', path, {
            name: 'Must not change',
            visibility: 'PRIVATE',
          })
        ).status,
      ).toBe(403);
      expect(await (await request(owner, 'GET', path)).json()).toMatchObject({
        name: 'Development Tools',
        visibility: 'PUBLIC',
      });
      expect(
        await (
          await request(collaborator, 'PATCH', path, {
            name: 'Developer Tools',
            description: 'Shared development tools',
          })
        ).json(),
      ).toMatchObject({
        name: 'Developer Tools',
        description: 'Shared development tools',
      });
      expect(
        (await request(collaborator, 'POST', linkPath, { toolId: saved[0].id }))
          .status,
      ).toBe(404);
      for (const [index, actor] of users.entries()) {
        expect(
          (await request(actor, 'POST', linkPath, { toolId: saved[index].id }))
            .status,
        ).toBe(201);
      }
      expect(
        (await request(collaborator, 'POST', linkPath, { toolId: saved[1].id }))
          .status,
      ).toBe(409);
      expect(
        await (await request(collaborator, 'GET', discovery)).json(),
      ).toContainEqual(
        expect.objectContaining({ id: collection.id, toolCount: 3 }),
      );
      for (const route of [linkPath, `${publicPath}/tools`]) {
        const response = await request(contributor, 'GET', route);
        expect(response.status).toBe(200);
        const items: unknown = await response.json();
        expect(items).toHaveLength(3);
        expect(items).toEqual(
          expect.arrayContaining(
            saved.map(({ id }, index) => ({
              id,
              name: ['Terminal', 'VS Code', 'Docker'][index],
              ownership: 'PERSONAL_LINK',
              websiteUrl: 'https://example.com/tool',
              accessType: 'FREE',
              category: { name: category.name },
            })),
          ),
        );
      }
      const ownerTool = `/tools/${saved[0].id}`;
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        expect(
          (
            await request(
              collaborator,
              method,
              ownerTool,
              method === 'PATCH' ? { name: 'Stolen' } : undefined,
            )
          ).status,
        ).toBe(404);
      }
      expect(
        (await request(contributor, 'DELETE', `${linkPath}/${saved[1].id}`))
          .status,
      ).toBe(204);
      expect(
        (await request(collaborator, 'GET', `/tools/${saved[1].id}`)).status,
      ).toBe(200);

      // Hold an uncommitted privatization until PostgreSQL confirms the link request is blocked.
      for (const [method, suffix, body] of [
        ['POST', '', { toolId: saved[1].id }],
        ['DELETE', `/${saved[2].id}`, undefined],
      ] as const) {
        expect(
          (await request(owner, 'PATCH', path, { visibility: 'PUBLIC' }))
            .status,
        ).toBe(200);
        let pending: Promise<Response> | undefined;
        await prisma.$transaction(async (tx) => {
          await tx.collection.update({
            where: { id: collection.id },
            data: { visibility: 'PRIVATE' },
          });
          pending = request(collaborator, method, `${linkPath}${suffix}`, body);
          let blocked = false;
          for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
            const [result] = await tx.$queryRaw<{ blocked: boolean }[]>`
              SELECT EXISTS (
                SELECT FROM pg_locks
                WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
              ) AS blocked
            `;
            blocked = result.blocked;
            if (!blocked)
              await new Promise((resolve) => setTimeout(resolve, 20));
          }
          expect(blocked).toBe(true);
        });
        expect((await pending)?.status).toBe(404);
      }
      expect(
        await (await request(contributor, 'GET', discovery)).json(),
      ).not.toContainEqual(expect.objectContaining({ id: collection.id }));
      for (const route of [path, linkPath, publicPath, `${publicPath}/tools`]) {
        expect((await request(contributor, 'GET', route)).status).toBe(404);
      }
      expect(
        (await request(contributor, 'PATCH', path, { name: 'Revoked' })).status,
      ).toBe(404);
      expect((await request(contributor, 'DELETE', path)).status).toBe(404);
      const privateTools: unknown = await (
        await request(owner, 'GET', linkPath)
      ).json();
      expect(privateTools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: saved[0].id,
            description: 'Private notes',
          }),
          {
            id: saved[2].id,
            name: 'Docker',
            ownership: 'PERSONAL_LINK',
            websiteUrl: 'https://example.com/tool',
            accessType: 'FREE',
            category: { name: category.name },
          },
        ]),
      );
      expect(privateTools).toHaveLength(2);
      expect(
        (await request(owner, 'PATCH', path, { visibility: 'PUBLIC' })).status,
      ).toBe(200);
      expect((await request(collaborator, 'DELETE', path)).status).toBe(204);
      expect(
        await prisma.toolCollectionLink.count({
          where: { collectionId: collection.id },
        }),
      ).toBe(0);
      expect((await request(owner, 'GET', path)).status).toBe(404);
      for (const [index, actor] of users.entries()) {
        expect(
          (await request(actor, 'GET', `/tools/${saved[index].id}`)).status,
        ).toBe(200);
      }
      const publicAtCreation = await create(owner, '/collections', {
        name: 'Published',
        visibility: 'PUBLIC',
      });
      expect(
        (
          await request(
            contributor,
            'GET',
            `${discovery}/${publicAtCreation.id}`,
          )
        ).status,
      ).toBe(200);
    } finally {
      await prisma.toolCollectionLink.deleteMany({
        where: { collectionId: { in: collections } },
      });
      await prisma.collection.deleteMany({
        where: { id: { in: collections } },
      });
      await prisma.tool.deleteMany({ where: { categoryId: category.id } });
      await prisma.category.delete({ where: { id: category.id } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
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
  it('preserves a populated previous schema when adding exclusive Tool business ownership', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const migration = async (name: string) =>
      readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      );
    const previous = await Promise.all(
      [
        '20261113132308_init_tools',
        '20261113174823_add_better_auth',
        '20261116133000_add_collections_and_tool_links',
        '20261123120000_add_collection_visibility',
        '20261123130000_add_tool_tags',
      ].map(migration),
    );
    const after = await migration('20261124120000_add_collection_owned_tools');
    const rollback = new Error('Roll back ownership migration fixture');
    try {
      await expect(
        prisma.$transaction(
          async (tx) => {
            const schema = `ownership_${crypto.randomUUID().replaceAll('-', '')}`;
            await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
            async function apply(sql: string) {
              for (const statement of sql
                .split(';')
                .map((value) => value.trim()))
                if (statement) await tx.$executeRawUnsafe(statement);
            }
            for (const sql of previous) await apply(sql);
            const [categoryId, tagId, toolId, collectionId, linkId] =
              Array.from({ length: 5 }, () => crypto.randomUUID());
            await tx.$executeRaw`INSERT INTO categories (id,name,slug,"updatedAt") VALUES (${categoryId}::uuid,'Legacy category','legacy-category',now())`;
            await tx.$executeRaw`INSERT INTO "user" (id,name,email,"updatedAt") VALUES ('legacy-owner','Legacy owner','legacy@example.test',now())`;
            await tx.$executeRaw`INSERT INTO "account" (id,"accountId","providerId","userId","updatedAt") VALUES ('legacy-account','legacy-owner','credential','legacy-owner',now())`;
            await tx.$executeRaw`INSERT INTO "session" (id,"expiresAt",token,"updatedAt","userId") VALUES ('legacy-session',now()+interval '1 day','legacy-test-token',now(),'legacy-owner')`;
            await tx.$executeRaw`INSERT INTO tools (id,"userId",name,"accessType","categoryId","updatedAt") VALUES (${toolId}::uuid,'legacy-owner','Legacy tool','FREE',${categoryId}::uuid,now())`;
            await tx.$executeRaw`INSERT INTO tags (id,name,slug,kind,"updatedAt") VALUES (${tagId}::uuid,'Legacy department','legacy-department','DEPARTMENT',now())`;
            await tx.$executeRaw`INSERT INTO tool_tags ("toolId","tagId") VALUES (${toolId}::uuid,${tagId}::uuid)`;
            await tx.$executeRaw`INSERT INTO collections (id,"userId",name,"updatedAt") VALUES (${collectionId}::uuid,'legacy-owner','Legacy collection',now())`;
            await tx.$executeRaw`INSERT INTO tool_collection_links (id,"toolId","collectionId") VALUES (${linkId}::uuid,${toolId}::uuid,${collectionId}::uuid)`;
            await apply(after);
            expect(
              await tx.$queryRaw`
          SELECT t."userId", t."collectionId", c.name AS category, d.name AS department, l.id AS link, cl.name AS collection
          FROM tools t JOIN categories c ON c.id=t."categoryId"
          JOIN tool_tags tt ON tt."toolId"=t.id JOIN tags d ON d.id=tt."tagId"
          JOIN tool_collection_links l ON l."toolId"=t.id JOIN collections cl ON cl.id=l."collectionId"
          WHERE t.id=${toolId}::uuid
        `,
            ).toEqual([
              {
                userId: 'legacy-owner',
                collectionId: null,
                category: 'Legacy category',
                department: 'Legacy department',
                link: linkId,
                collection: 'Legacy collection',
              },
            ]);
            expect(
              await tx.$queryRaw`SELECT (SELECT count(*) FROM "user") AS users, (SELECT count(*) FROM "account") AS accounts, (SELECT count(*) FROM "session") AS sessions`,
            ).toEqual([{ users: 1n, accounts: 1n, sessions: 1n }]);
            await tx.$executeRaw`INSERT INTO tools (id,"collectionId",name,"accessType","categoryId","updatedAt") VALUES (${crypto.randomUUID()}::uuid,${collectionId}::uuid,'Owned tool','FREE',${categoryId}::uuid,now())`;
            expect(
              await tx.$queryRaw`SELECT "userId", "collectionId" FROM tools WHERE name='Owned tool'`,
            ).toEqual([{ userId: null, collectionId }]);
            throw rollback;
          },
          { timeout: 15_000 },
        ),
      ).rejects.toBe(rollback);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('authorizes collection-owned CRUD, keeps personal links private, and atomically cleans owned data', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL!,
      }),
    });
    const category = await prisma.category.create({
      data: { name: `Owned ${crypto.randomUUID()}`, slug: crypto.randomUUID() },
    });
    const tag = await prisma.tag.create({
      data: {
        name: `Owned department ${crypto.randomUUID()}`,
        slug: `owned-${crypto.randomUUID()}`,
        kind: 'DEPARTMENT',
      },
    });
    const collectionIds: string[] = [];
    const emails: string[] = [];
    const fields = {
      name: 'Canva',
      categoryId: category.id,
      accessType: 'FREE',
      description: 'Shared collection notes',
      websiteUrl:
        'https://person:secret@example.com/tool?token=private#private',
      tagIds: [tag.id],
    };
    const guard = `owned_cleanup_${crypto.randomUUID().replaceAll('-', '')}`;
    async function register(index: number) {
      const email = `owned-${crypto.randomUUID()}@example.com`;
      emails.push(email);
      const response = await post(
        'sign-up/email',
        { email, password, name: `Owner fixture ${index}` },
        `192.0.2.${60 + index}`,
      );
      expect(response.status).toBe(200);
      const data = (await response.json()) as { user: { id: string } };
      return { cookie, id: data.user.id };
    }
    async function request(
      actor: string,
      method: string,
      path: string,
      body?: object,
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
    async function collection(
      actor: string,
      visibility: 'PUBLIC' | 'PRIVATE' = 'PRIVATE',
    ) {
      const response = await request(actor, 'POST', '/collections', {
        name: 'Owned tools fixture',
        visibility,
      });
      expect(response.status).toBe(201);
      const item = (await response.json()) as { id: string };
      collectionIds.push(item.id);
      return item.id;
    }
    async function createOwned(actor: string, id: string) {
      const response = await request(
        actor,
        'POST',
        `/collections/${id}/owned-tools`,
        fields,
      );
      expect(response.status).toBe(201);
      const tool = (await response.json()) as { id: string };
      expect(tool).toMatchObject({
        userId: null,
        collectionId: id,
        ownership: 'COLLECTION',
        category: { id: category.id },
        tags: [expect.objectContaining({ id: tag.id })],
        websiteUrl: 'https://example.com/tool',
      });
      return tool.id;
    }
    async function waitForBlocked(
      tx: Prisma.TransactionClient,
    ) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [result] = await tx.$queryRaw<
          { blocked: boolean }[]
        >`SELECT EXISTS (SELECT FROM pg_locks WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (result.blocked) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(
        'Expected the collection request to wait on its row lock',
      );
    }
    try {
      const owner = await register(0);
      const contributor = await register(1);
      const member = await register(2);
      const privateId = await collection(owner.cookie);
      const privateToolId = await createOwned(owner.cookie, privateId);
      const privatePath = `/collections/${privateId}/owned-tools/${privateToolId}`;
      expect((await request(owner.cookie, 'GET', privatePath)).status).toBe(
        200,
      );
      expect(
        (
          await request(owner.cookie, 'PATCH', privatePath, {
            name: 'Updated private tool',
            tagIds: [],
          })
        ).status,
      ).toBe(200);
      for (const [method, path, body] of [
        ['GET', privatePath, undefined],
        ['PATCH', privatePath, { name: 'Stolen' }],
        ['DELETE', privatePath, undefined],
        ['POST', `/collections/${privateId}/owned-tools`, fields],
        ['GET', `/collections/${privateId}/tools`, undefined],
      ] as const) {
        expect(
          (await request(contributor.cookie, method, path, body)).status,
        ).toBe(404);
        expect((await request('', method, path, body)).status).toBe(401);
      }
      expect((await request(owner.cookie, 'DELETE', privatePath)).status).toBe(
        204,
      );
      expect((await request(owner.cookie, 'GET', privatePath)).status).toBe(
        404,
      );
      const publicId = await collection(owner.cookie, 'PUBLIC');
      const secondId = await collection(owner.cookie, 'PUBLIC');
      const path = `/collections/${publicId}`;
      const ownedPath = `${path}/owned-tools`;
      const toolId = await createOwned(contributor.cookie, publicId);
      const toolPath = `${ownedPath}/${toolId}`;
      expect(await prisma.toolCollectionLink.count({ where: { toolId } })).toBe(
        0,
      );
      for (const actor of [owner.cookie, contributor.cookie, member.cookie]) {
        expect(
          await (await request(actor, 'GET', '/tools')).json(),
        ).not.toContainEqual(expect.objectContaining({ id: toolId }));
        for (const method of ['GET', 'PATCH', 'DELETE']) {
          expect(
            (
              await request(
                actor,
                method,
                `/tools/${toolId}`,
                method === 'PATCH' ? { name: 'Stolen' } : undefined,
              )
            ).status,
          ).toBe(404);
        }
      }
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        expect(
          (
            await request(
              member.cookie,
              method,
              `/collections/${secondId}/owned-tools/${toolId}`,
              method === 'PATCH' ? { name: 'Wrong collection' } : undefined,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await request(
              '',
              method,
              toolPath,
              method === 'PATCH' ? { name: 'No auth' } : undefined,
            )
          ).status,
        ).toBe(401);
      }
      expect((await request('', 'POST', ownedPath, fields)).status).toBe(401);
      expect((await request('', 'GET', `${path}/tools`)).status).toBe(401);
      expect(
        (await request('', 'GET', `/public-collections/${publicId}/tools`))
          .status,
      ).toBe(401);
      expect(
        (
          await request(
            owner.cookie,
            'POST',
            `/collections/${secondId}/tools`,
            { toolId },
          )
        ).status,
      ).toBe(404);
      for (const body of [
        { ...fields, userId: owner.id },
        { ...fields, collectionId: secondId },
        { ...fields, tagIds: [crypto.randomUUID()] },
        { ...fields, categoryId: crypto.randomUUID() },
        { ...fields, websiteUrl: 'javascript:alert(1)' },
      ]) {
        expect(
          (await request(member.cookie, 'POST', ownedPath, body)).status,
        ).toBe(400);
      }
      for (const body of [
        { userId: member.id },
        { collectionId: secondId },
        { name: ' ' },
        { name: 'Must roll back', tagIds: [crypto.randomUUID()] },
      ]) {
        expect(
          (await request(member.cookie, 'PATCH', toolPath, body)).status,
        ).toBe(400);
      }
      expect(
        await prisma.tool.count({ where: { collectionId: publicId } }),
      ).toBe(1);
      expect(
        await (await request(member.cookie, 'GET', toolPath)).json(),
      ).toMatchObject({
        name: 'Canva',
        tags: [expect.objectContaining({ id: tag.id })],
      });
      expect(
        (
          await request(
            member.cookie,
            'POST',
            '/collections/invalid/owned-tools',
            fields,
          )
        ).status,
      ).toBe(400);
      for (const method of ['GET', 'PATCH', 'DELETE'])
        expect(
          (
            await request(
              member.cookie,
              method,
              `${ownedPath}/invalid`,
              method === 'PATCH' ? { name: 'Invalid' } : undefined,
            )
          ).status,
        ).toBe(400);
      for (const data of [
        { userId: null, collectionId: null },
        { userId: owner.id, collectionId: publicId },
      ]) {
        await expect(
          prisma.tool.create({
            data: {
              ...data,
              name: 'Invalid owner',
              categoryId: category.id,
              accessType: 'FREE',
            },
          }),
        ).rejects.toThrow(/tools_exactly_one_owner|check constraint/i);
      }
      const edited = await request(member.cookie, 'PATCH', toolPath, {
        name: 'Shared edit',
        description: null,
        accessType: 'LICENSED',
        tagIds: [],
      });
      expect(edited.status).toBe(200);
      expect(await edited.json()).toMatchObject({
        name: 'Shared edit',
        description: null,
        tags: [],
        userId: null,
        collectionId: publicId,
      });
      const deletable = await createOwned(contributor.cookie, publicId);
      expect(
        (await request(member.cookie, 'DELETE', `${ownedPath}/${deletable}`))
          .status,
      ).toBe(204);
      expect(await prisma.toolTag.count({ where: { toolId: deletable } })).toBe(
        0,
      );
      expect(
        (await request(member.cookie, 'PATCH', path, { visibility: 'PRIVATE' }))
          .status,
      ).toBe(403);
      expect(
        (await request(owner.cookie, 'PATCH', path, { visibility: 'PRIVATE' }))
          .status,
      ).toBe(200);
      expect((await request(owner.cookie, 'GET', toolPath)).status).toBe(200);
      expect(
        await prisma.tool.findUnique({ where: { id: toolId } }),
      ).toMatchObject({ collectionId: publicId, userId: null });
      for (const [method, target, body] of [
        ['GET', toolPath, undefined],
        ['PATCH', toolPath, { name: 'Revoked' }],
        ['DELETE', toolPath, undefined],
        ['POST', ownedPath, fields],
      ] as const)
        expect(
          (await request(member.cookie, method, target, body)).status,
        ).toBe(404);
      expect(
        (
          await request(
            member.cookie,
            'GET',
            `/public-collections/${publicId}/tools`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await request(owner.cookie, 'PATCH', path, { visibility: 'PUBLIC' }))
          .status,
      ).toBe(200);
      const personalResponse = await request(
        contributor.cookie,
        'POST',
        '/tools',
        { ...fields, description: 'Private personal notes' },
      );
      expect(personalResponse.status).toBe(201);
      const personal = (await personalResponse.json()) as { id: string };
      expect(
        await prisma.tool.findUnique({ where: { id: personal.id } }),
      ).toMatchObject({ userId: contributor.id, collectionId: null });
      expect(
        (
          await request(contributor.cookie, 'POST', `${path}/tools`, {
            toolId: personal.id,
          })
        ).status,
      ).toBe(201);
      for (const target of [
        `${path}/tools`,
        `/public-collections/${publicId}/tools`,
      ]) {
        const rows = (await (
          await request(member.cookie, 'GET', target)
        ).json()) as { id: string; ownership: string }[];
        expect(rows.find((row) => row.id === toolId)).toMatchObject({
          ownership: 'COLLECTION',
          name: 'Shared edit',
          tags: [],
        });
        const summary = rows.find((row) => row.id === personal.id);
        expect(summary).toEqual({
          id: personal.id,
          ownership: 'PERSONAL_LINK',
          name: 'Canva',
          websiteUrl: 'https://example.com/tool',
          accessType: 'FREE',
          category: { name: category.name },
        });
      }
      expect(
        await (
          await request(member.cookie, 'GET', '/public-collections')
        ).json(),
      ).toContainEqual(expect.objectContaining({ id: publicId, toolCount: 2 }));
      expect(
        (await request(member.cookie, 'DELETE', `${path}/tools/${personal.id}`))
          .status,
      ).toBe(204);
      expect(
        (await request(contributor.cookie, 'GET', `/tools/${personal.id}`))
          .status,
      ).toBe(200);
      expect(
        (await request(contributor.cookie, 'DELETE', `/tools/${personal.id}`))
          .status,
      ).toBe(204);
      await prisma.user.delete({ where: { id: contributor.id } });
      expect((await request(owner.cookie, 'GET', toolPath)).status).toBe(200);
      // Permission checks must re-read visibility after waiting for the collection lock.
      for (const [method, target, body] of [
        ['POST', ownedPath, fields],
        ['PATCH', toolPath, { name: 'Revoked' }],
        ['DELETE', toolPath, undefined],
        ['GET', toolPath, undefined],
      ] as const) {
        await request(owner.cookie, 'PATCH', path, { visibility: 'PUBLIC' });
        let pending: Promise<Response> | undefined;
        await prisma.$transaction(async (tx) => {
          await tx.collection.update({
            where: { id: publicId },
            data: { visibility: 'PRIVATE' },
          });
          pending = request(member.cookie, method, target, body);
          await waitForBlocked(tx);
        });
        expect((await pending)?.status).toBe(404);
      }
      await request(owner.cookie, 'PATCH', path, { visibility: 'PUBLIC' });
      const personalOwner = await request(
        owner.cookie,
        'POST',
        '/tools',
        fields,
      );
      const original = (await personalOwner.json()) as { id: string };
      expect(personalOwner.status).toBe(201);
      expect(
        (
          await request(owner.cookie, 'POST', `${path}/tools`, {
            toolId: original.id,
          })
        ).status,
      ).toBe(201);
      const taggedOwned = await createOwned(owner.cookie, publicId);
      // Fail the final cleanup write and prove earlier Tool/ToolTag deletes and parent deletion roll back.
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${guard}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."collectionId"='${publicId}'::uuid THEN RAISE EXCEPTION 'test cleanup rollback'; END IF; RETURN OLD; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${guard}" BEFORE DELETE ON tool_collection_links FOR EACH ROW EXECUTE FUNCTION "${guard}"()`,
      );
      expect((await request(owner.cookie, 'DELETE', path)).status).toBe(500);
      expect(await prisma.collection.count({ where: { id: publicId } })).toBe(
        1,
      );
      expect(
        await prisma.tool.count({ where: { collectionId: publicId } }),
      ).toBe(2);
      expect(
        await prisma.toolTag.count({ where: { toolId: taggedOwned } }),
      ).toBe(1);
      expect(
        await prisma.toolCollectionLink.count({
          where: { collectionId: publicId },
        }),
      ).toBe(1);
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER "${guard}" ON tool_collection_links`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${guard}"()`);
      expect((await request(member.cookie, 'DELETE', path)).status).toBe(204);
      expect(
        await prisma.tool.count({ where: { collectionId: publicId } }),
      ).toBe(0);
      expect(
        await prisma.toolTag.count({ where: { toolId: taggedOwned } }),
      ).toBe(0);
      expect(
        await prisma.toolCollectionLink.count({
          where: { collectionId: publicId },
        }),
      ).toBe(0);
      expect(
        (await request(owner.cookie, 'GET', `/tools/${original.id}`)).status,
      ).toBe(200);
      expect(await prisma.tag.count({ where: { id: tag.id } })).toBe(1);
      const raceId = await collection(owner.cookie, 'PUBLIC');
      let pending: Promise<Response> | undefined;
      await prisma.$transaction(async (tx) => {
        await tx.collection.delete({ where: { id: raceId } });
        pending = request(
          member.cookie,
          'POST',
          `/collections/${raceId}/owned-tools`,
          fields,
        );
        await waitForBlocked(tx);
      });
      expect((await pending)?.status).toBe(404);
      expect(await prisma.tool.count({ where: { collectionId: raceId } })).toBe(
        0,
      );
      const queuedId = await collection(owner.cookie, 'PUBLIC');
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM collections WHERE id=${queuedId}::uuid FOR SHARE`;
        await tx.tool.create({
          data: {
            collectionId: queuedId,
            userId: null,
            name: 'Committed while delete waits',
            categoryId: category.id,
            accessType: 'FREE',
            toolTags: { create: { tagId: tag.id } },
          },
        });
        pending = request(member.cookie, 'DELETE', `/collections/${queuedId}`);
        await waitForBlocked(tx);
      });
      expect((await pending)?.status).toBe(204);
      expect(
        await prisma.tool.count({ where: { collectionId: queuedId } }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${guard}" ON tool_collection_links`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${guard}"()`);
      await prisma.toolCollectionLink.deleteMany({
        where: { collectionId: { in: collectionIds } },
      });
      await prisma.tool.deleteMany({ where: { categoryId: category.id } });
      await prisma.collection.deleteMany({
        where: { id: { in: collectionIds } },
      });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await prisma.tag.delete({ where: { id: tag.id } });
      await prisma.category.delete({ where: { id: category.id } });
      await prisma.$disconnect();
    }
  }, 60_000);
});
