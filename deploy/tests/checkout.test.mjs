import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { sha256, verifyEffectiveCompose } from '../scripts/github-compose-policy.mjs';
import { verifyCheckout } from '../scripts/verify-checkout.mjs';

test('actual Git checkout, effective Compose and env digests must match; races and tampering are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tooltrack-checkout-'));
  const source = readFileSync('deploy/dokploy/compose.yaml', 'utf8');
  const appName = 'tooltrack-staging-test';
  const generated = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  generated.networks[appName] = { name: appName, external: true };
  for (const [name, service] of Object.entries(generated.services)) {
    service.networks.push(appName);
    service.labels = { 'dokploy.service': name };
    if (name === 'web') service.labels['traefik.enable'] = 'true';
  }
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  try {
    mkdirSync(join(directory, 'deploy/dokploy'), { recursive: true });
    writeFileSync(join(directory, 'deploy/dokploy/compose.yaml'), source);
    git('init', '-q'); git('config', 'user.name', 'Disposable checkout test'); git('config', 'user.email', 'test@example.com');
    git('config', 'core.autocrlf', 'false'); git('add', '.'); git('commit', '-qm', 'approved');
    const inputs = { TOOLTRACK_SOURCE_REVISION: git('rev-parse', 'HEAD'), TOOLTRACK_COMPOSE_SHA256: sha256(source),
      TOOLTRACK_DEPLOYMENT_NONCE: crypto.randomUUID(), TOOLTRACK_APP_NAME: appName,
      WEB_IMAGE: `ghcr.io/ben-001-sys/tooltrack-web@sha256:${'c'.repeat(64)}`,
      API_IMAGE: `ghcr.io/ben-001-sys/tooltrack-api@sha256:${'d'.repeat(64)}` };
    writeFileSync(join(directory, 'compose.yaml'), yaml.dump(generated));
    const environment = Object.entries({ ...inputs, APP_NAME: appName, UNRELATED_SECRET: 'never-print-this' }).map(([key, value]) => `${key}=${value}`).join('\n');
    writeFileSync(join(directory, 'deployment.env'), environment);
    assert.match(verifyCheckout(directory, inputs), /^TOOLTRACK_SOURCE_VERIFIED /);
    for (const mutate of [value => { value.services.web.image = 'wrong:latest'; },
      value => { value.services.api.ports = ['3001:3001']; },
      value => { value.services.migrate.command = ['node', '-e', 'process.exit(0)']; },
      value => { value.networks.database.internal = false; },
      value => { value.services.postgres.labels['traefik.enable'] = 'true'; }]) {
      const changed = structuredClone(generated); mutate(changed);
      assert.throws(() => verifyEffectiveCompose(source, yaml.dump(changed), appName));
    }
    assert.throws(() => verifyCheckout(directory, { ...inputs, TOOLTRACK_COMPOSE_SHA256: '0'.repeat(64) }));
    writeFileSync(join(directory, 'deployment.env'), environment.replace(inputs.WEB_IMAGE, 'mutable:latest'));
    assert.throws(() => verifyCheckout(directory, inputs));
    writeFileSync(join(directory, 'deployment.env'), environment);
    git('commit', '--allow-empty', '-qm', 'branch advanced while queued');
    assert.throws(() => verifyCheckout(directory, inputs), /Checkout advanced/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
