import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchImages } from '../scripts/dokploy-deploy.mjs';
test('image updates preserve every unrelated environment assignment and reject ambiguous keys', () => {
  const input = '# keep\nWEB_IMAGE=old-web\nPOSTGRES_PASSWORD=private-value\nAPI_IMAGE=old-api\nOTHER="keep me"\n';
  assert.equal(patchImages(input, { web: 'web@digest', api: 'api@digest' }),
    '# keep\nWEB_IMAGE=web@digest\nPOSTGRES_PASSWORD=private-value\nAPI_IMAGE=api@digest\nOTHER="keep me"\n');
  assert.throws(() => patchImages(input + 'WEB_IMAGE=duplicate\n', { web: 'x', api: 'y' }));
  assert.throws(() => patchImages('OTHER=keep', { web: 'x', api: 'y' }));
});
