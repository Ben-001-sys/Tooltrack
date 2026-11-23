import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

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
});
