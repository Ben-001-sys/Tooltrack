import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { proxyApi } from '../../apps/web/src/lib/api-proxy.mjs';

const original = { ...process.env };
after(() => { process.env = original; });

test('runtime upstream, verbs, query, body, headers, cookies, redirects and failures', async () => {
  const servers = [];
  try {
    for (const id of ['first', 'second']) {
      const server = createServer(async (req, res) => {
        const parts = [];
        for await (const part of req) parts.push(part);
        res.setHeader('set-cookie', ['session=one; HttpOnly; Secure; SameSite=Lax', 'other=two; HttpOnly']);
        if (req.url.startsWith('/api/auth/redirect')) {
          res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/api/auth/finish` });
          res.end(); return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id, url: req.url, method: req.method,
          body: Buffer.concat(parts).toString(), headers: req.headers }));
      }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      servers.push(server);
    }
    process.env.WEB_ORIGIN = 'https://web.example.com';
    for (const [index, server] of servers.entries()) {
      process.env.API_ORIGIN = `http://127.0.0.1:${server.address().port}`;
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
        const body = ['GET', 'HEAD'].includes(method) ? undefined : 'hello=world';
        const response = await proxyApi(new Request('https://web.example.com/api/v1/echo?q=a%20b', {
          method, body, headers: { origin: 'https://web.example.com', cookie: 'session=test',
            'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-host': 'attacker.example' },
        }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.getSetCookie().length, 2);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        if (method === 'HEAD') { assert.equal(await response.text(), ''); continue; }
        const value = await response.json();
        assert.equal(value.id, index === 0 ? 'first' : 'second');
        assert.equal(value.method, method);
        assert.equal(value.url, '/api/v1/echo?q=a%20b');
        assert.equal(value.body, body ?? '');
        assert.equal(value.headers.cookie, 'session=test');
        assert.equal(value.headers['x-forwarded-host'], 'web.example.com');
        assert.equal(value.headers['x-forwarded-proto'], 'https');
      }
      const redirect = await proxyApi(new Request('https://web.example.com/api/auth/redirect'));
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get('location'), 'https://web.example.com/api/auth/finish');
    }
    assert.equal((await proxyApi(new Request('https://web.example.com/api/v1/echo', {
      method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}',
    }))).status, 403);
    assert.equal((await proxyApi(new Request('https://web.example.com/https://evil.example'))).status, 404);
    process.env.API_ORIGIN = 'https://user:password@example.com/path';
    assert.equal((await proxyApi(new Request('https://web.example.com/api/auth/get-session'))).status, 503);
    process.env.API_ORIGIN = 'http://127.0.0.1:1';
    assert.equal((await proxyApi(new Request('https://web.example.com/api/auth/get-session'))).status, 502);
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
});
