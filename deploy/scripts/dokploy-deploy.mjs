import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { smokeTest } from './smoke-test.mjs';
import { validateManifest } from './verify-release.mjs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { COMPOSE_PATH, patchDeploymentEnvironment, requireResourceCondition, SafeResourceValidationError, sha256, sourceMarker, validateGithubResource } from './github-compose-policy.mjs';

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

// The first-production exception is allowed only for a genuinely empty Compose project.
// Query the Docker host as well as Dokploy history: deployment history alone is not proof
// that a persisted PostgreSQL volume or stopped container does not exist.
export async function verifyInitialProductionState(api, resource, history, checkpoint = () => {}) {
  // Dokploy retains attempts that failed before Compose could initialize.
  // Only known failed records are acceptable; success, cancellation, in-progress
  // and unrecognized states remain unsafe for a backup-free initial deployment.
  requireResourceCondition(Array.isArray(history) && history.every(item =>
    typeof item?.deploymentId === 'string' && item.deploymentId.length > 0 &&
    item.status === 'error'), 'initial.historyStatus');
  const query = resource.serverId ? { serverId: resource.serverId } : {};
  checkpoint('reading production Docker volume inventory');
  let volumeResponse;
  try { volumeResponse = await api('dockerVolume.getVolumes', undefined, query); }
  catch { throw new SafeResourceValidationError('initial.volumeInventoryAccess'); }
  const volumes = Array.isArray(volumeResponse) ? volumeResponse
    : volumeResponse?.Volumes ?? volumeResponse?.volumes;
  requireResourceCondition(Array.isArray(volumes), 'initial.volumeInventoryShape');
  const expectedVolume = `${resource.appName}_postgres_data`;
  for (const volume of volumes) {
    const name = volume?.Name ?? volume?.name;
    requireResourceCondition(typeof name === 'string', 'initial.volumeInventoryShape');
    const labels = volume.Labels ?? volume.labels ?? {};
    requireResourceCondition(labels && typeof labels === 'object' && !Array.isArray(labels),
      'initial.volumeInventoryShape');
    requireResourceCondition(name !== expectedVolume &&
      !(name.startsWith(`${resource.appName}_`) && /postgres/i.test(name)) &&
      labels['com.docker.compose.project'] !== resource.appName,
      'initial.existingVolume');
  }
  checkpoint('reading production Docker container inventory');
  let containerResponse;
  try { containerResponse = await api('docker.getContainers', undefined, query); }
  catch { throw new SafeResourceValidationError('initial.containerInventoryAccess'); }
  const containers = Array.isArray(containerResponse) ? containerResponse
    : containerResponse?.containers ?? containerResponse?.Containers;
  requireResourceCondition(Array.isArray(containers), 'initial.containerInventoryShape');
  for (const container of containers) {
    const labels = container.Labels ?? container.labels ?? {};
    requireResourceCondition(labels && typeof labels === 'object' && !Array.isArray(labels),
      'initial.containerInventoryShape');
    const names = container.Names ?? container.names ??
      (container.Name ?? container.name ? [container.Name ?? container.name] : null);
    requireResourceCondition(Array.isArray(names) && names.every(name => typeof name === 'string'),
      'initial.containerInventoryShape');
    requireResourceCondition(labels['com.docker.compose.project'] !== resource.appName &&
      !names.some(name => name.includes(resource.appName)),
      'initial.existingContainer');
  }
}

export async function deploy(manifest, target, dependencies = {}) {
  const environmentValues = dependencies.environment ?? process.env;
  const write = dependencies.write ?? writeFileSync;
  const read = dependencies.read ?? readFileSync;
  const smoke = dependencies.smoke ?? smokeTest;
  const log = dependencies.log ?? console.log;
  const checkpoint = message => log(`DEPLOYMENT_CHECKPOINT ${target}: ${message}`);
  checkpoint('validating manifest and deployment enablement');
  validateManifest(manifest, { accepted: target === 'production' });
  assert.ok(['staging', 'production'].includes(target));
  const required = name => { assert.ok(environmentValues[name], `Missing ${name}`); return environmentValues[name]; };
  assert.equal(required('DEPLOY_ENABLED'), 'true', 'Deployment must be explicitly enabled after setup verification');
  const initialDeployment = target === 'production' && environmentValues.INITIAL_DEPLOYMENT === 'true';
  if (target === 'production') {
    assert.equal(required('PRODUCTION_APPROVED'), 'true');
    if (initialDeployment) {
      assert.ok(!environmentValues.BACKUP_REFERENCE && !environmentValues.BACKUP_VERIFIED_AT,
        'Do not supply backup details in initial deployment mode');
    } else {
      const backupTime = Date.parse(required('BACKUP_VERIFIED_AT'));
      assert.ok(Date.now() - backupTime >= 0 && Date.now() - backupTime < 24 * 3600_000,
        'Require a backup verified in the past 24 hours');
      required('BACKUP_REFERENCE');
    }
  }
  checkpoint('validating protected environment configuration');
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
  checkpoint('reading Dokploy Compose, environment and project metadata');
  const resource = await api('compose.one', undefined, { composeId });
  const environment = await api('environment.one', undefined, { environmentId });
  const project = await api('project.one', undefined, { projectId });
  checkpoint('checking Dokploy resource identity and guarded command');
  requireResourceCondition(project.name === 'ToolTrack', 'project.name');
  requireResourceCondition(resource.environmentId === environmentId, 'resource.environmentId');
  requireResourceCondition(environment.projectId === projectId, 'environment.projectId');
  requireResourceCondition(environment.name === target, 'environment.name');
  validateGithubResource(resource, target, required('DOKPLOY_VERIFIER_IMAGE'));
  checkpoint('checking resource environment and database identity');
  const configuration = parseEnv(resource.env ?? '');
  assert.equal(configuration.WEB_ORIGIN, new URL(required('SMOKE_BASE_URL')).origin);
  const database = new URL(configuration.DATABASE_URL);
  assert.equal(database.hostname, 'postgres', 'Database must stay on this Compose network');
  assert.equal(database.pathname, `/${configuration.POSTGRES_DB}`);
  assert.equal(decodeURIComponent(database.username), configuration.POSTGRES_USER);
  assert.equal(decodeURIComponent(database.password), configuration.POSTGRES_PASSWORD);
  // GitHub ref preflight rejects stale jobs. The immutable server-side verifier
  // checks the actual checkout again after Dokploy clones it, closing that race.
  checkpoint('checking approved branch head and Compose source');
  const proof = { ...(dependencies.approvedSource ?? approvedSource)(manifest, target), nonce: crypto.randomUUID() };
  checkpoint('checking for existing active deployments');
  const before = await api('deployment.allByCompose', undefined, { composeId });
  assert.ok(Array.isArray(before), 'Unexpected deployment API shape');
  assert.ok(!before.some(item => ['running', 'queued'].includes(item.status)), 'Another deployment is active');
  if (initialDeployment) {
    checkpoint('verifying failed-only deployment history and absent production data');
    await verifyInitialProductionState(api, resource, before, checkpoint);
  }
  checkpoint('preparing immutable images and authorization without changing server state');
  const images = patchDeploymentEnvironment(resource.env, manifest.images, proof);
  const previous = { WEB_IMAGE: configuration.WEB_IMAGE, API_IMAGE: configuration.API_IMAGE };
  write('deployment-record.json', JSON.stringify({ target, initialDeployment, source: manifest.source, composeRevision: proof.revision,
    composeSha256: proof.composeHash, nonce: proof.nonce,
    images: manifest.images, previous, status: 'pending', startedAt: new Date().toISOString() }, null, 2));
  checkpoint('saving authorized deployment environment');
  await api('compose.saveEnvironment', { composeId, env: images, createEnvFile: true });
  // Detect concurrent dashboard edits before asking Dokploy to deploy.
  const saved = await api('compose.one', undefined, { composeId });
  assert.equal(saved.env, images, 'Environment changed concurrently; stop and reconcile');
  validateGithubResource(saved, target, required('DOKPLOY_VERIFIER_IMAGE'));
  const title = `tooltrack-${target}-${manifest.source}-${crypto.randomUUID().slice(0, 8)}`;
  checkpoint('requesting authorized Compose deployment');
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

// Field-only diagnostic for policy mismatches; untrusted API responses, errors and
// environment values are never printed to CI logs.
export function safeDeploymentFailureMessage(error) {
  if (error instanceof SafeResourceValidationError) return error.message;
  return 'Deployment failed. Inspect deployment-record.json and Dokploy deployment logs. No automatic database rollback was attempted.';
}

if (process.argv[1]?.endsWith('dokploy-deploy.mjs')) {
  try { await deploy(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3]); }
  catch (error) {
    let record = {};
    try { record = JSON.parse(readFileSync('deployment-record.json', 'utf8')); } catch { /* failure before mutation */ }
    writeFileSync('deployment-record.json', JSON.stringify({ ...record, status: 'failed', failedAt: new Date().toISOString() }, null, 2));
    console.error(safeDeploymentFailureMessage(error));
    process.exitCode = 1;
  }
}
