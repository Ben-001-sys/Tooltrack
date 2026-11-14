import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { smokeTest } from './smoke-test.mjs';
import { validateManifest } from './verify-release.mjs';
import { parseEnv } from 'node:util';

export function patchImages(environment, images) {
  assert.equal(typeof environment, 'string', 'Existing Compose environment must be readable');
  let patched = environment;
  for (const [key, value] of Object.entries({ WEB_IMAGE: images.web, API_IMAGE: images.api })) {
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    assert.equal([...patched.matchAll(pattern)].length, 1, `Expected exactly one ${key} assignment`);
    patched = patched.replace(pattern, `${key}=${value}`);
  }
  return patched;
}

export async function deploy(manifest, target) {
  validateManifest(manifest, { accepted: target === 'production' });
  assert.ok(['staging', 'production'].includes(target));
  const required = name => { assert.ok(process.env[name], `Missing ${name}`); return process.env[name]; };
  assert.equal(required('DEPLOY_ENABLED'), 'true', 'Deployment must be explicitly enabled after setup verification');
  if (target === 'production') {
    assert.equal(required('PRODUCTION_APPROVED'), 'true');
    const backupTime = Date.parse(required('BACKUP_VERIFIED_AT'));
    assert.ok(Date.now() - backupTime >= 0 && Date.now() - backupTime < 24 * 3600_000, 'Require a backup verified in the past 24 hours');
    required('BACKUP_REFERENCE');
  }
  const base = new URL(required('DOKPLOY_URL'));
  assert.equal(base.protocol, 'https:');
  const key = required('DOKPLOY_API_KEY');
  const composeId = required('DOKPLOY_COMPOSE_ID');
  const environmentId = required('DOKPLOY_ENVIRONMENT_ID');
  const projectId = required('DOKPLOY_PROJECT_ID');
  async function api(path, body, query = {}) {
    const url = new URL(`/api/${path}`, base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { method: body ? 'POST' : 'GET',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000), redirect: 'error' });
    assert.ok(response.ok, `Dokploy ${path}: HTTP ${response.status}`);
    return response.json(); // never log raw responses: they can contain secrets
  }
  const resource = await api('compose.one', undefined, { composeId });
  const environment = await api('environment.one', undefined, { environmentId });
  const project = await api('project.one', undefined, { projectId });
  assert.equal(project.name, 'ToolTrack');
  assert.equal(resource.environmentId, environmentId);
  assert.equal(environment.projectId, projectId);
  assert.equal(environment.name, target);
  assert.equal(resource.name, `tooltrack-stack-${target}`);
  assert.equal(resource.composeType, 'docker-compose');
  assert.equal(resource.sourceType, 'raw');
  assert.equal(resource.autoDeploy, false, 'Disable uncontrolled Git auto-deploy');
  assert.equal(resource.isolatedDeployment, true);
  const configuration = parseEnv(resource.env ?? '');
  assert.equal(configuration.WEB_ORIGIN, new URL(required('SMOKE_BASE_URL')).origin);
  const database = new URL(configuration.DATABASE_URL);
  assert.equal(database.hostname, 'postgres', 'Database must stay on this Compose network');
  assert.equal(database.pathname, `/${configuration.POSTGRES_DB}`);
  assert.equal(decodeURIComponent(database.username), configuration.POSTGRES_USER);
  assert.equal(decodeURIComponent(database.password), configuration.POSTGRES_PASSWORD);
  const expectedCompose = readFileSync('deploy/dokploy/compose.yaml', 'utf8').replace(/\r\n/g, '\n').trim();
  assert.equal(resource.composeFile?.replace(/\r\n/g, '\n').trim(), expectedCompose, 'Reviewed Compose configuration must match');
  const before = await api('deployment.allByCompose', undefined, { composeId });
  assert.ok(Array.isArray(before), 'Unexpected deployment API shape');
  assert.ok(!before.some(item => ['running', 'queued'].includes(item.status)), 'Another deployment is active');
  const images = patchImages(resource.env, manifest.images);
  const previous = {};
  for (const name of ['WEB_IMAGE', 'API_IMAGE']) previous[name] = resource.env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
  writeFileSync('deployment-record.json', JSON.stringify({ target, source: manifest.source,
    images: manifest.images, previous, status: 'pending', startedAt: new Date().toISOString() }, null, 2));
  await api('compose.saveEnvironment', { composeId, env: images, createEnvFile: true });
  // Detect concurrent dashboard edits before asking Dokploy to deploy.
  const saved = await api('compose.one', undefined, { composeId });
  assert.equal(saved.env, images, 'Environment changed concurrently; stop and reconcile');
  const title = `tooltrack-${target}-${manifest.source}-${crypto.randomUUID().slice(0, 8)}`;
  await api('compose.deploy', { composeId, title, description: `Verified revision ${manifest.source}`, freshVolumes: false });
  let deployment;
  for (let attempt = 0; attempt < 120; attempt++) {
    const history = await api('deployment.allByCompose', undefined, { composeId });
    deployment = history.find(item => item.title === title);
    if (deployment?.status === 'error') throw new Error('Dokploy deployment failed; inspect its preserved deployment logs');
    if (deployment?.status === 'done') break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(deployment?.status, 'done', 'Dokploy deployment did not finish before timeout');
  const publicUrl = required('SMOKE_BASE_URL');
  await smokeTest(publicUrl);
  const record = JSON.parse(readFileSync('deployment-record.json', 'utf8'));
  Object.assign(record, { status: 'passed', deploymentId: deployment.deploymentId, verifiedAt: new Date().toISOString() });
  writeFileSync('deployment-record.json', JSON.stringify(record, null, 2));
  if (target === 'staging') {
    manifest.staging = { status: 'passed', source: manifest.source, url: publicUrl, verifiedAt: record.verifiedAt,
      deploymentId: deployment.deploymentId };
    writeFileSync('accepted-candidate.json', JSON.stringify(manifest, null, 2));
  }
  console.log(`PASS ${target} Dokploy deployment and HTTPS smoke checks`);
}

if (process.argv[1]?.endsWith('dokploy-deploy.mjs')) {
  try { await deploy(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3]); }
  catch {
    let record = {};
    try { record = JSON.parse(readFileSync('deployment-record.json', 'utf8')); } catch { /* failure before mutation */ }
    writeFileSync('deployment-record.json', JSON.stringify({ ...record, status: 'failed', failedAt: new Date().toISOString() }, null, 2));
    console.error('Deployment failed. Inspect deployment-record.json and Dokploy deployment logs. No automatic database rollback was attempted.');
    process.exitCode = 1;
  }
}
