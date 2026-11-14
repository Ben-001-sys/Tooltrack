import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { approvedSource, deploy } from '../scripts/dokploy-deploy.mjs';
import { guardedCommand, patchDeploymentEnvironment, sourceMarker, validateGithubResource } from '../scripts/github-compose-policy.mjs';
const images = { web: `ghcr.io/ben-001-sys/tooltrack-web@sha256:${'c'.repeat(64)}`,
  api: `ghcr.io/ben-001-sys/tooltrack-api@sha256:${'d'.repeat(64)}` };
const proof = { revision: 'a'.repeat(40), composeHash: 'b'.repeat(64), nonce: crypto.randomUUID() };
test('branch preflight uses staging candidate or approved main revision and rejects a moving head', () => {
  const manifest = { source: 'a'.repeat(40), approvedSource: 'b'.repeat(40) };
  for (const target of ['staging', 'production']) {
    const expected = target === 'staging' ? manifest.source : manifest.approvedSource;
    const execute = (command, args) => {
      if (command === 'gh') { assert.ok(args[1].endsWith(target === 'staging' ? '/staging' : '/main')); return JSON.stringify({ object: { sha: expected } }); }
      assert.deepEqual(args, ['show', `${expected}:deploy/dokploy/compose.yaml`]);
      return Buffer.from('approved compose source');
    };
    assert.equal(approvedSource(manifest, target, execute).revision, expected);
    let gitCalled = false;
    assert.throws(() => approvedSource(manifest, target, command => {
      if (command === 'git') gitCalled = true;
      return JSON.stringify({ object: { sha: 'f'.repeat(40) } });
    }), /Branch advanced/);
    assert.equal(gitCalled, false);
  }
});
test('image updates preserve every unrelated environment assignment and reject ambiguous keys', () => {
  const input = '# keep\nWEB_IMAGE=old-web\nPOSTGRES_PASSWORD=private-value\nAPI_IMAGE=old-api\nOTHER="keep me"\n';
  const patched = patchDeploymentEnvironment(input, images, proof);
  assert.equal(patched.split('TOOLTRACK_SOURCE_REVISION=')[0],
    `# keep\nWEB_IMAGE=${images.web}\nPOSTGRES_PASSWORD=private-value\nAPI_IMAGE=${images.api}\nOTHER="keep me"\n`);
  assert.equal(patchDeploymentEnvironment(patched, images, proof), patched);
  assert.throws(() => patchDeploymentEnvironment(input + '  export WEB_IMAGE=duplicate\n', images, proof));
  assert.throws(() => patchDeploymentEnvironment('OTHER=keep', images, proof));
  assert.throws(() => patchDeploymentEnvironment(input, { ...images, web: 'mutable:latest' }, proof));
});

function fixture(target = 'staging') {
  const environment = { DEPLOY_ENABLED: 'true', PRODUCTION_APPROVED: 'true', BACKUP_REFERENCE: 'backup-test',
    BACKUP_VERIFIED_AT: new Date().toISOString(), DOKPLOY_URL: 'https://dokploy.example.com',
    DOKPLOY_API_KEY: 'fake-test-key', DOKPLOY_COMPOSE_ID: 'compose-test', DOKPLOY_ENVIRONMENT_ID: target,
    DOKPLOY_PROJECT_ID: 'project-test', SMOKE_BASE_URL: `https://${target}.example.com`, DOKPLOY_VERIFIER_IMAGE: images.api };
  const resource = { sourceType: 'github', owner: 'Ben-001-sys', repository: 'Tooltrack', githubId: 'test-app-provider',
    branch: target === 'staging' ? 'staging' : 'main', composePath: 'deploy/dokploy/compose.yaml', composeType: 'docker-compose',
    name: `tooltrack-stack-${target}`, appName: `tooltrack-${target}-test`, autoDeploy: false, isolatedDeployment: true,
    randomize: false, isolatedDeploymentsVolume: false, createEnvFile: true, environmentId: target,
    env: `WEB_IMAGE=previous-web\nAPI_IMAGE=previous-api\nWEB_ORIGIN=${environment.SMOKE_BASE_URL}\nPOSTGRES_USER=test\nPOSTGRES_DB=test\nPOSTGRES_PASSWORD=keep-private\nDATABASE_URL=postgresql://test:keep-private@postgres/test\nOTHER=untouched\n` };
  resource.command = guardedCommand(resource.appName, images.api);
  const manifest = { schemaVersion: 1, source: proof.revision, approvedSource: proof.revision, tree: 'e'.repeat(40),
    ciRunId: 1, images, migrations: ['init/migration.sql'], staging: { status: 'passed', source: proof.revision,
      url: 'https://staging.example.com', verifiedAt: new Date().toISOString() } };
  const writes = new Map();
  const calls = [];
  let launched = false;
  let saved;
  let smokeCalls = 0;
  const controls = { wrongMarker: false, concurrentEdit: false };
  const dependencies = { environment, log: () => {}, approvedSource: () => ({ revision: proof.revision, composeHash: proof.composeHash }),
    write: (path, text) => writes.set(path, text), read: path => writes.get(path), smoke: async () => { smokeCalls++; },
    api: async (path, body) => {
      calls.push({ path, body });
      if (path === 'compose.one') return { ...resource, env: saved ? saved + (controls.concurrentEdit ? 'CONCURRENT=edit\n' : '') : resource.env };
      if (path === 'environment.one') return { name: target, projectId: 'project-test' };
      if (path === 'project.one') return { name: 'ToolTrack' };
      if (path === 'compose.saveEnvironment') { saved = body.env; return {}; }
      if (path === 'compose.deploy') { assert.equal(body.freshVolumes, false); launched = true; return { success: true }; }
      if (path === 'deployment.allByCompose') return launched ? [{ deploymentId: 'new-deployment', status: 'done', title: 'Git commit title replacing caller title' }] : [];
      if (path === 'deployment.readLogs') {
        const values = parseEnv(saved);
        return controls.wrongMarker ? 'No valid verification proof\n' : sourceMarker({ revision: values.TOOLTRACK_SOURCE_REVISION,
          composeHash: values.TOOLTRACK_COMPOSE_SHA256, nonce: values.TOOLTRACK_DEPLOYMENT_NONCE }, images);
      }
      throw new Error(`Unexpected fake API route ${path}`);
    } };
  return { resource, manifest, dependencies, calls, writes, controls, smokeCalls: () => smokeCalls };
}

test('GitHub resource policy rejects Raw, wrong App/repository/branch/path, auto-deploy and unguarded commands', () => {
  for (const change of [{ sourceType: 'raw' }, { githubId: '' }, { repository: 'wrong' }, { branch: 'main' },
    { composePath: 'compose.yaml' }, { autoDeploy: true }, { command: 'compose up -d' }, { isolatedDeployment: false }]) {
    const f = fixture();
    assert.throws(() => validateGithubResource({ ...f.resource, ...change }, 'staging', images.api));
  }
});

test('mocked GitHub deployment preserves secrets, tracks overwritten titles, and requires actual checkout proof', async () => {
  const f = fixture();
  await deploy(f.manifest, 'staging', f.dependencies);
  assert.equal(JSON.parse(f.writes.get('deployment-record.json')).status, 'passed');
  assert.ok(f.writes.has('accepted-candidate.json'));
  const update = f.calls.find(call => call.path === 'compose.saveEnvironment');
  assert.ok(update.body.env.includes('POSTGRES_PASSWORD=keep-private\n'));
  assert.ok(update.body.env.includes('OTHER=untouched\n'));
  assert.equal(f.smokeCalls(), 1);
  assert.ok(!JSON.stringify([...f.writes.values()]).includes('keep-private'));
});

test('mocked deployment stops on changed settings, concurrent environment edits and missing source proof', async () => {
  for (const scenario of ['autoDeploy', 'concurrentEdit', 'wrongMarker']) {
    const f = fixture();
    if (scenario === 'autoDeploy') f.resource.autoDeploy = true;
    else f.controls[scenario] = true;
    await assert.rejects(deploy(f.manifest, 'staging', f.dependencies));
    assert.equal(f.smokeCalls(), 0);
    if (scenario !== 'wrongMarker') assert.ok(!f.calls.some(call => call.path === 'compose.deploy'));
    assert.ok(!f.writes.has('accepted-candidate.json'));
  }
});

test('production still requires explicit approval and current backup evidence before any API call', async () => {
  for (const change of [{ PRODUCTION_APPROVED: 'false' }, { BACKUP_VERIFIED_AT: '2000-01-01T00:00:00Z' }]) {
    const f = fixture('production'); Object.assign(f.dependencies.environment, change);
    await assert.rejects(deploy(f.manifest, 'production', f.dependencies));
    assert.equal(f.calls.length, 0);
  }
});
