import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { COMPOSE_PATH, imageReference, sha256, sourceMarker, verifyEffectiveCompose } from './github-compose-policy.mjs';

export function verifyCheckout(directory, inputs = process.env) {
  const proof = { revision: inputs.TOOLTRACK_SOURCE_REVISION, composeHash: inputs.TOOLTRACK_COMPOSE_SHA256,
    nonce: inputs.TOOLTRACK_DEPLOYMENT_NONCE };
  assert.match(proof.revision, /^[a-f0-9]{40}$/);
  assert.match(proof.composeHash, /^[a-f0-9]{64}$/);
  assert.match(proof.nonce, /^[a-f0-9-]{36}$/);
  const images = { web: imageReference(inputs.WEB_IMAGE, 'web'), api: imageReference(inputs.API_IMAGE, 'api') };
  assert.match(inputs.TOOLTRACK_APP_NAME, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/);
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${directory}`, '-C', directory, ...args],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 * 1024 * 1024 });
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), proof.revision, 'Checkout advanced or differs from approval');
  const source = git('show', `HEAD:${COMPOSE_PATH}`);
  assert.equal(sha256(source), proof.composeHash, 'Checked-out Compose source hash differs');
  const environment = parseEnv(readFileSync(`${directory}/deployment.env`, 'utf8'));
  for (const [key, value] of Object.entries({ WEB_IMAGE: images.web, API_IMAGE: images.api,
    TOOLTRACK_SOURCE_REVISION: proof.revision, TOOLTRACK_COMPOSE_SHA256: proof.composeHash,
    TOOLTRACK_DEPLOYMENT_NONCE: proof.nonce })) assert.equal(environment[key], value, 'Compose environment does not match approval');
  assert.equal(environment.APP_NAME, inputs.TOOLTRACK_APP_NAME, 'Wrong Compose resource environment');
  verifyEffectiveCompose(source.toString(), readFileSync(`${directory}/compose.yaml`, 'utf8'), inputs.TOOLTRACK_APP_NAME);
  return sourceMarker(proof, images);
}
if (process.argv[1]?.endsWith('verify-checkout.mjs')) {
  try {
    const authorization = parseEnv(readFileSync('/checkout/deployment.env', 'utf8'));
    console.log(verifyCheckout('/checkout', { ...authorization, TOOLTRACK_APP_NAME: process.env.TOOLTRACK_APP_NAME }));
  }
  catch { console.error('ToolTrack checkout/configuration verification failed; Compose was not authorized to start.'); process.exitCode = 1; }
}
