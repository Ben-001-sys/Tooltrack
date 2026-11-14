import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

describe('compiled API against disposable PostgreSQL', () => {
  let child: ChildProcess;
  let base: string;
  let cookie = '';
  const email = `ci-${crypto.randomUUID()}@example.com`;
  const password = `test-${crypto.randomUUID()}-Aa1!`;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must identify a disposable migrated database');
    const socket = createServer().listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const port = address.port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['dist/main.js'], {
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: process.env.TEST_DATABASE_URL,
        PORT: String(port), BETTER_AUTH_URL: base, WEB_ORIGIN: base,
        BETTER_AUTH_SECRET: 'disposable-ci-auth-secret-with-at-least-32-characters' },
      stdio: 'pipe',
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('API exited during startup');
      try { if ((await fetch(`${base}/api/v1/health`)).ok) return; }
      catch { /* wait for the process to bind */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('API readiness timed out');
  }, 30_000);

  afterAll(async () => {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  });

  async function post(path: string, body: object) {
    const response = await fetch(`${base}/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie },
      body: JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
    return response;
  }

  it('reports health and denies anonymous protected access', async () => {
    expect(await (await fetch(`${base}/api/v1/health`)).json()).toMatchObject({ status: 'ok' });
    expect((await fetch(`${base}/api/v1/session`)).status).toBe(401);
  });

  it('registers, persists a session, logs out and logs in', async () => {
    expect((await post('sign-up/email', { email, password, name: 'CI user' })).ok).toBe(true);
    expect(cookie).not.toBe('');
    const session = await fetch(`${base}/api/v1/session`, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ authenticated: true, user: { email } });
    const revokedCookie = cookie;
    expect((await post('sign-out', {})).ok).toBe(true);
    expect((await fetch(`${base}/api/v1/session`, { headers: { cookie: revokedCookie } })).status).toBe(401);
    cookie = '';
    expect((await fetch(`${base}/api/v1/session`)).status).toBe(401);
    expect((await post('sign-in/email', { email, password })).ok).toBe(true);
    expect((await fetch(`${base}/api/v1/session`, { headers: { cookie } })).status).toBe(200);
    const forbidden = await fetch(`${base}/api/auth/sign-out`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example' }, body: '{}',
    });
    expect(forbidden.status).toBe(403);
    expect((await post('sign-out', {})).ok).toBe(true);
  });
});
