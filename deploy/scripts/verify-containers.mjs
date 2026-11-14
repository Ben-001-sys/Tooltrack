import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { smokeTest } from './smoke-test.mjs';

const directory = mkdtempSync(join(tmpdir(), 'tooltrack-test-'));
const project = `tooltrack-test-${crypto.randomUUID().slice(0, 8)}`;
const password = crypto.randomUUID();
const file = resolve('deploy/dokploy/compose.yaml');
const override = join(directory, 'ports.yaml');
writeFileSync(override, 'services:\n  web:\n    ports: ["127.0.0.1::3000"]\n');
const env = { ...process.env,
  WEB_IMAGE: process.env.WEB_IMAGE ?? 'tooltrack-web:verify',
  API_IMAGE: process.env.API_IMAGE ?? 'tooltrack-api:verify',
  WEB_ORIGIN: 'http://localhost:3000', POSTGRES_USER: 'ci', POSTGRES_DB: 'tooltrack_ci',
  POSTGRES_PASSWORD: password, DATABASE_URL: `postgresql://ci:${password}@postgres:5432/tooltrack_ci`,
  BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
};
function docker(args, options = {}) { return execFileSync('docker', args, { env, encoding: 'utf8', ...options }); }
const composeArgs = ['compose', '-p', project, '-f', file, '-f', override];
function compose(args, options) { return docker([...composeArgs, ...args], options); }
try {
  compose(['config', '--quiet']);
  compose(['up', '-d', '--wait', '--wait-timeout', '180'], { stdio: 'inherit' });
  const port = compose(['port', 'web', '3000']).trim().split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  await smokeTest(base, { allowHttp: true });
  let cookie = '';
  const email = `container-${crypto.randomUUID()}@example.com`;
  const userPassword = crypto.randomUUID() + 'Aa1!';
  async function auth(path, body) {
    const response = await fetch(`${base}/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: env.WEB_ORIGIN, cookie },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, `Auth ${path} returned ${response.status}`);
    if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return response;
  }
  await auth('sign-up/email', { email, password: userPassword, name: 'Disposable test' });
  assert.equal((await fetch(`${base}/api/v1/session`, { headers: { cookie } })).status, 200);
  await auth('sign-out', {});
  cookie = '';
  assert.equal((await fetch(`${base}/api/v1/session`)).status, 401);
  await auth('sign-in/email', { email, password: userPassword });
  assert.equal((await fetch(`${base}/api/v1/session`, { headers: { cookie } })).status, 200);
  await auth('sign-out', {});
  const db = compose(['ps', '-q', 'postgres']).trim();
  const backup = docker(['exec', db, 'pg_dump', '-U', 'ci', '-d', 'tooltrack_ci', '-Fc'], { encoding: 'buffer' });
  docker(['exec', db, 'createdb', '-U', 'ci', 'restore_verification']);
  docker(['exec', '-i', db, 'pg_restore', '-U', 'ci', '-d', 'restore_verification', '--exit-on-error', '--no-owner'], { input: backup });
  const restored = docker(['exec', db, 'psql', '-U', 'ci', '-d', 'restore_verification', '-tAc', 'SELECT count(*) FROM "user"']);
  assert.ok(Number(restored.trim()) >= 1, 'Restored users missing');
  compose(['restart', 'postgres', 'api', 'web'], { stdio: 'inherit' });
  compose(['up', '-d', '--wait', '--wait-timeout', '180'], { stdio: 'inherit' });
  const persisted = docker(['exec', db, 'psql', '-U', 'ci', '-d', 'tooltrack_ci', '-tAc', 'SELECT count(*) FROM "user"']);
  assert.equal(persisted, restored);
  const restartedPort = compose(['port', 'web', '3000']).trim().split(':').at(-1);
  await smokeTest(`http://127.0.0.1:${restartedPort}`, { allowHttp: true });
  console.log('PASS container auth lifecycle, database persistence, restart and disposable restore');
} catch (error) {
  compose(['logs', '--no-color', '--tail', '100'], { stdio: 'inherit' });
  throw error;
} finally {
  // The random project is created only by this test; never accepts an operator project name.
  assert.match(project, /^tooltrack-test-[a-f0-9-]{8}$/);
  compose(['down', '--volumes', '--remove-orphans'], { stdio: 'inherit' });
  rmSync(directory, { recursive: true, force: true });
}
