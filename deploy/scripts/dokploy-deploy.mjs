import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { smokeTest } from './smoke-test.mjs';
import { validateManifest } from './verify-release.mjs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { COMPOSE_PATH, patchDeploymentEnvironment, sha256, sourceMarker, validateGithubResource } from './github-compose-policy.mjs';

export function approvedSource(manifest, target, execute = execFileSync) {
  const revision = target === 'production' ? manifest.approvedSource : manifest.source;
  assert.match(revision, /^[a-f0-9]{40}$/);
  const branch = target === 'production' ? 'main' : 'staging';
  const ref = JSON.parse(execute('gh', ['api', `repos/Ben-001-sys/Tooltrack/git/ref/heads/${branch}`], { encoding: 'utf8' }));
  assert.equal(ref.object.sha, revision, 'Branch advanced; obtain a candidate/release for its current approved revision');
  const source = execute('git', ['show', `${revision}:${COMPOSE_PATH}`]);
  assert.ok(source.length > 0 && source.length < 1024 * 1024);
  return { revision, composeHash: sha256(source) };
}

export async function deploy(manifest, target, dependencies = {}) {
  const environmentValues = dependencies.environment ?? process.env;
  const write = dependencies.write ?? writeFileSync;
  const read = dependencies.read ?? readFileSync;
  const smoke = dependencies.smoke ?? smokeTest;
  const log = dependencies.log ?? console.log;
  validateManifest(manifest, { accepted: target === 'production' });
  assert.ok(['staging', 'production'].includes(target));
  const required = name => { assert.ok(environmentValues[name], `Missing ${name}`); return environmentValues[name]; };
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
  const api = dependencies.api ?? (async function requestApi(path, body, query = {}) {
    const url = new URL(`/api/${path}`, base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { method: body ? 'POST' : 'GET',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000), redirect: 'error' });
    assert.ok(response.ok, `Dokploy ${path}: HTTP ${response.status}`);
    return response.json(); // never log raw responses: they can contain secrets
  });
  const resource = await api('compose.one', undefined, { composeId });
  const environment = await api('environment.one', undefined, { environmentId });
  const project = await api('project.one', undefined, { projectId });
  assert.equal(project.name, 'ToolTrack');
  assert.equal(resource.environmentId, environmentId);
  assert.equal(environment.projectId, projectId);
  assert.equal(environment.name, target);
  validateGithubResource(resource, target, required('DOKPLOY_VERIFIER_IMAGE'));
  const configuration = parseEnv(resource.env ?? '');
  assert.equal(configuration.WEB_ORIGIN, new URL(required('SMOKE_BASE_URL')).origin);
  const database = new URL(configuration.DATABASE_URL);
  assert.equal(database.hostname, 'postgres', 'Database must stay on this Compose network');
  assert.equal(database.pathname, `/${configuration.POSTGRES_DB}`);
  assert.equal(decodeURIComponent(database.username), configuration.POSTGRES_USER);
  assert.equal(decodeURIComponent(database.password), configuration.POSTGRES_PASSWORD);
  // GitHub ref preflight rejects stale jobs. The immutable server-side verifier
  // checks the actual checkout again after Dokploy clones it, closing that race.
  const proof = { ...(dependencies.approvedSource ?? approvedSource)(manifest, target), nonce: crypto.randomUUID() };
  const before = await api('deployment.allByCompose', undefined, { composeId });
  assert.ok(Array.isArray(before), 'Unexpected deployment API shape');
  assert.ok(!before.some(item => ['running', 'queued'].includes(item.status)), 'Another deployment is active');
  const images = patchDeploymentEnvironment(resource.env, manifest.images, proof);
  const previous = { WEB_IMAGE: configuration.WEB_IMAGE, API_IMAGE: configuration.API_IMAGE };
  write('deployment-record.json', JSON.stringify({ target, source: manifest.source, composeRevision: proof.revision,
    composeSha256: proof.composeHash, nonce: proof.nonce,
    images: manifest.images, previous, status: 'pending', startedAt: new Date().toISOString() }, null, 2));
  await api('compose.saveEnvironment', { composeId, env: images, createEnvFile: true });
  // Detect concurrent dashboard edits before asking Dokploy to deploy.
  const saved = await api('compose.one', undefined, { composeId });
  assert.equal(saved.env, images, 'Environment changed concurrently; stop and reconcile');
  validateGithubResource(saved, target, required('DOKPLOY_VERIFIER_IMAGE'));
  const title = `tooltrack-${target}-${manifest.source}-${crypto.randomUUID().slice(0, 8)}`;
  await api('compose.deploy', { composeId, title, description: `Verified revision ${manifest.source}`, freshVolumes: false });
  let deployment;
  const knownIds = new Set(before.map(item => item.deploymentId));
  for (let attempt = 0; attempt < 120; attempt++) {
    const history = await api('deployment.allByCompose', undefined, { composeId });
    // GitHub-backed Dokploy replaces the requested title with the Git message.
    const added = history.filter(item => !knownIds.has(item.deploymentId));
    assert.ok(added.length <= 1, 'Concurrent deployment detected; stop and inspect history');
    deployment = added[0];
    if (['error', 'cancelled'].includes(deployment?.status)) throw new Error('Dokploy deployment failed; inspect its preserved deployment logs');
    if (deployment?.status === 'done') break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(deployment?.status, 'done', 'Dokploy deployment did not finish before timeout');
  const logs = await api('deployment.readLogs', undefined, { deploymentId: deployment.deploymentId, tail: '10000' });
  assert.equal(typeof logs, 'string', 'Unexpected deployment log API shape');
  const expectedMarker = sourceMarker(proof, manifest.images);
  assert.ok(logs.split(/\r?\n/).some(line => line.trim() === expectedMarker), 'Missing actual checkout, generated Compose and digest verification proof');
  const publicUrl = required('SMOKE_BASE_URL');
  await smoke(publicUrl);
  const record = JSON.parse(read('deployment-record.json', 'utf8'));
  Object.assign(record, { status: 'passed', deploymentId: deployment.deploymentId, verifiedAt: new Date().toISOString() });
  write('deployment-record.json', JSON.stringify(record, null, 2));
  if (target === 'staging') {
    manifest.staging = { status: 'passed', source: manifest.source, url: publicUrl, verifiedAt: record.verifiedAt,
      deploymentId: deployment.deploymentId };
    write('accepted-candidate.json', JSON.stringify(manifest, null, 2));
  }
  log(`PASS ${target} Dokploy deployment and HTTPS smoke checks`);
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
