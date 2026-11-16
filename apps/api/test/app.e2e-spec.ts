import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
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

  async function post(path: string, body: object) {
    const response = await fetch(`${base}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie },
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
});
