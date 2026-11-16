import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const project = `tooltrack-test-${crypto.randomUUID().slice(0, 8)}`;
const directory = mkdtempSync(join(tmpdir(), 'tooltrack-migration-gate-'));
const override = join(directory, 'failure.yaml');
writeFileSync(override, 'services:\n  migrate:\n    command: [node, -e, "process.exit(17)"]\n');
const password = crypto.randomUUID();
const env = { ...process.env, WEB_IMAGE: process.env.WEB_IMAGE ?? 'tooltrack-web:verify',
  API_IMAGE: process.env.API_IMAGE ?? 'tooltrack-api:verify', POSTGRES_USER: 'ci', POSTGRES_DB: 'gate_test',
  POSTGRES_PASSWORD: password, DATABASE_URL: `postgresql://ci:${password}@postgres:5432/gate_test`,
  WEB_ORIGIN: 'http://localhost:3000', BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID() };
const args = ['compose', '-p', project, '-f', resolve('deploy/dokploy/compose.yaml'), '-f', override];
const docker = (...options) => execFileSync('docker', options, { env, encoding: 'utf8' }).trim();
try {
  let failed = false;
  try { docker(...args, 'up', '-d', '--wait', '--wait-timeout', '60'); }
  catch { failed = true; }
  assert.equal(failed, true, 'Compose must fail when migration fails');
  const migrate = docker(...args, 'ps', '-a', '-q', 'migrate');
  assert.equal(docker('inspect', migrate, '--format', '{{.State.ExitCode}}'), '17');
  for (const service of ['api', 'web']) {
    const container = docker(...args, 'ps', '-a', '-q', service);
    if (container) assert.equal(docker('inspect', container, '--format', '{{.State.Running}}'), 'false');
  }
  console.log('PASS failed migration prevents API and Web startup');
} finally {
  assert.match(project, /^tooltrack-test-[a-f0-9-]{8}$/);
  docker(...args, 'down', '--volumes', '--remove-orphans');
  rmSync(directory, { recursive: true, force: true });
}
