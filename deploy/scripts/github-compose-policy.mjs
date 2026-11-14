import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

export const COMPOSE_PATH = 'deploy/dokploy/compose.yaml';
export const ENV_PATH = 'deploy/dokploy/.env';
export const REVISION_KEYS = ['TOOLTRACK_SOURCE_REVISION', 'TOOLTRACK_COMPOSE_SHA256', 'TOOLTRACK_DEPLOYMENT_NONCE'];
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function imageReference(value, app) {
  assert.match(value, new RegExp(`^ghcr\\.io/ben-001-sys/tooltrack-${app}@sha256:[a-f0-9]{64}$`), 'An immutable ToolTrack image reference is required');
  return value;
}
export function guardedCommand(appName, verifierImage) {
  assert.match(appName, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/);
  imageReference(verifierImage, 'api');
  const mounts = [
    'type=bind,source=./.git,target=/checkout/.git,readonly',
    `type=bind,source=./${COMPOSE_PATH},target=/checkout/compose.yaml,readonly`,
    `type=bind,source=./${ENV_PATH},target=/checkout/deployment.env,readonly`,
  ].map(value => `--mount ${value}`).join(' ');
  // Compose resources receive their values through the generated .env file;
  // Dokploy does not export those variables into its Docker client's environment.
  return `run --rm --network none --read-only ${mounts} --env TOOLTRACK_APP_NAME=${appName} ${verifierImage} node /app/deploy/scripts/verify-checkout.mjs` +
    ` && docker compose --project-directory . --env-file ${ENV_PATH} -p ${appName} -f ${COMPOSE_PATH} up -d --wait --wait-timeout 180 --pull always --remove-orphans`;
}
export function validateGithubResource(resource, target, verifierImage) {
  assert.equal(resource.sourceType, 'github');
  assert.equal(resource.owner, 'Ben-001-sys');
  assert.equal(resource.repository, 'Tooltrack');
  assert.equal(resource.branch, target === 'staging' ? 'staging' : 'main');
  assert.equal(resource.composePath, COMPOSE_PATH);
  assert.equal(resource.composeType, 'docker-compose');
  assert.equal(resource.name, `tooltrack-stack-${target}`);
  assert.ok(typeof resource.githubId === 'string' && resource.githubId.length > 0, 'Official GitHub App provider must be configured');
  assert.equal(resource.autoDeploy, false, 'The GitHub App grants source access only');
  assert.equal(resource.isolatedDeployment, true);
  assert.ok(!resource.randomize && !resource.isolatedDeploymentsVolume, 'Keep stable service and volume identity');
  assert.ok(!resource.suffix || resource.suffix === resource.appName, 'Use the resource App Name as the isolated network identity');
  assert.equal(resource.createEnvFile, true);
  assert.equal(resource.command, guardedCommand(resource.appName, verifierImage), 'Manually install the exact guarded command before enabling deployments');
}
export function patchDeploymentEnvironment(environment, images, proof) {
  assert.equal(typeof environment, 'string', 'Existing environment must be readable');
  imageReference(images.web, 'web'); imageReference(images.api, 'api');
  assert.match(proof.revision, /^[a-f0-9]{40}$/);
  assert.match(proof.composeHash, /^[a-f0-9]{64}$/);
  assert.match(proof.nonce, /^[a-f0-9-]{36}$/);
  let result = environment;
  const values = { WEB_IMAGE: images.web, API_IMAGE: images.api,
    TOOLTRACK_SOURCE_REVISION: proof.revision, TOOLTRACK_COMPOSE_SHA256: proof.composeHash,
    TOOLTRACK_DEPLOYMENT_NONCE: proof.nonce };
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, 'gm');
    const assignments = [...result.matchAll(pattern)];
    assert.ok(assignments.length <= 1, `Duplicate controlled environment key ${key}`);
    if (assignments.length) result = result.replace(pattern, `${key}=${value}`);
    else {
      assert.ok(REVISION_KEYS.includes(key), `Provision ${key} manually first`);
      result += `${result.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
    }
  }
  return result;
}
export function sourceMarker(proof, images) {
  return `TOOLTRACK_SOURCE_VERIFIED ${proof.nonce} ${proof.revision} ${proof.composeHash} ${images.web} ${images.api}`;
}
export function verifyEffectiveCompose(source, generated, appName) {
  const expected = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  const actual = yaml.load(generated, { schema: yaml.JSON_SCHEMA });
  assert.ok(actual && expected && actual.services && actual.networks, 'Invalid Compose document');
  // Dokploy's isolated-deployment transform adds one resource-specific network.
  assert.deepEqual(actual.networks[appName], { name: appName, external: true });
  delete actual.networks[appName];
  for (const [name, service] of Object.entries(actual.services)) {
    assert.ok(expected.services[name], 'Unexpected service in generated Compose');
    assert.ok(Array.isArray(service.networks), 'Unexpected generated service network shape');
    assert.ok(service.networks.includes(appName), 'Isolated ingress network missing');
    service.networks = service.networks.filter(network => network !== appName);
    const labels = Array.isArray(service.labels)
      ? Object.fromEntries(service.labels.map(label => { const at = label.indexOf('='); return [label.slice(0, at), label.slice(at + 1)]; }))
      : service.labels ?? {};
    for (const key of Object.keys(labels)) {
      assert.ok(key.startsWith('dokploy.') || (name === 'web' && key.startsWith('traefik.')), 'Unexpected generated label');
    }
    delete service.labels;
  }
  // Everything except the narrowly allowed ingress/metadata changes must match.
  // This preserves images, commands, migrations, ports, volumes and private networks.
  assert.deepEqual(actual, expected, 'Generated Compose differs from approved source');
}
