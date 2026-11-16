import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import yaml from 'js-yaml';
import { sha256 } from './github-compose-policy.mjs';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(resolve('tmp'), 'tooltrack-checkout-'));
const appName = 'tooltrack-guard-disposable';
const image = process.env.API_IMAGE ?? 'tooltrack-api:verify';
const source = readFileSync('deploy/dokploy/compose.yaml', 'utf8');
const generated = yaml.load(source, { schema: yaml.JSON_SCHEMA });
generated.networks[appName] = { name: appName, external: true };
for (const [name, service] of Object.entries(generated.services)) {
  service.networks.push(appName); service.labels = { 'dokploy.service': name };
  if (name === 'web') service.labels['traefik.enable'] = 'true';
}
const execute = (command, args, options = {}) => execFileSync(command, args, { cwd: directory, encoding: 'utf8', ...options });
try {
  mkdirSync(join(directory, 'deploy/dokploy'), { recursive: true });
  writeFileSync(join(directory, 'deploy/dokploy/compose.yaml'), source);
  execute('git', ['init', '-q']); execute('git', ['config', 'user.name', 'Disposable container checkout']);
  execute('git', ['config', 'user.email', 'test@example.com']); execute('git', ['config', 'core.autocrlf', 'false']);
  execute('git', ['add', '.']); execute('git', ['commit', '-qm', 'approved']);
  const revision = execute('git', ['rev-parse', 'HEAD']).trim();
  writeFileSync(join(directory, 'deploy/dokploy/compose.yaml'), yaml.dump(generated));
  const environment = `APP_NAME=${appName}\nTOOLTRACK_SOURCE_REVISION=${revision}\nTOOLTRACK_COMPOSE_SHA256=${sha256(source)}\nTOOLTRACK_DEPLOYMENT_NONCE=${crypto.randomUUID()}\nWEB_IMAGE=ghcr.io/ben-001-sys/tooltrack-web@sha256:${'c'.repeat(64)}\nAPI_IMAGE=ghcr.io/ben-001-sys/tooltrack-api@sha256:${'d'.repeat(64)}\nPRIVATE_SECRET=never-print-this-test-secret\n`;
  writeFileSync(join(directory, 'deploy/dokploy/.env'), environment);
  const args = ['run', '--rm', '--network', 'none', '--read-only',
    '--mount', 'type=bind,source=./.git,target=/checkout/.git,readonly',
    '--mount', 'type=bind,source=./deploy/dokploy/compose.yaml,target=/checkout/compose.yaml,readonly',
    '--mount', 'type=bind,source=./deploy/dokploy/.env,target=/checkout/deployment.env,readonly',
    '--env', `TOOLTRACK_APP_NAME=${appName}`, image, 'node', '/app/deploy/scripts/verify-checkout.mjs'];
  const success = execute('docker', args);
  assert.match(success, /^TOOLTRACK_SOURCE_VERIFIED /);
  assert.ok(!success.includes('PRIVATE_SECRET') && !success.includes('never-print-this-test-secret'));
  generated.services.web.image = 'unexpected:latest';
  writeFileSync(join(directory, 'deploy/dokploy/compose.yaml'), yaml.dump(generated));
  let rejected = false;
  try { execute('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) {
    rejected = true;
    assert.ok(!String(error.stdout).includes('never-print-this-test-secret'));
    assert.ok(!String(error.stderr).includes('never-print-this-test-secret'));
  }
  assert.ok(rejected, 'The actual verifier image must reject a modified effective Compose file');
  console.log('PASS read-only, network-disabled Docker checkout verifier; tampering rejected without exposing secrets');
} finally { rmSync(directory, { recursive: true, force: true }); }
