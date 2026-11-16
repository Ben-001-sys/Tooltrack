import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function validateManifest(manifest, { accepted = false } = {}) {
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.source, /^[a-f0-9]{40}$/);
  assert.match(manifest.tree, /^[a-f0-9]{40}$/);
  for (const app of ['web', 'api']) {
    assert.match(manifest.images[app], new RegExp(`^ghcr\\.io/ben-001-sys/tooltrack-${app}@sha256:[a-f0-9]{64}$`));
  }
  assert.ok(Number.isSafeInteger(manifest.ciRunId) && manifest.ciRunId > 0);
  assert.ok(Array.isArray(manifest.migrations) && manifest.migrations.length > 0);
  if (accepted) {
    assert.equal(manifest.staging?.status, 'passed');
    assert.equal(manifest.staging?.source, manifest.source);
    assert.match(manifest.staging?.url, /^https:\/\//);
    assert.ok(Number.isFinite(Date.parse(manifest.staging?.verifiedAt)));
  }
  return manifest;
}

export function verifySource(manifest, approved) {
  assert.match(approved, /^[a-f0-9]{40}$/);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', `${manifest.source}^{tree}`), manifest.tree, 'Candidate source tree mismatch');
  assert.equal(git('rev-parse', `${approved}^{tree}`), manifest.tree,
    'Approved main differs from tested staging source. Build and validate a new candidate.');
  git('merge-base', '--is-ancestor', approved, 'origin/main');
  const migrations = git('ls-tree', '-r', '--name-only', approved, 'apps/api/prisma/migrations')
    .split('\n').filter(path => path.endsWith('/migration.sql'));
  assert.deepEqual(manifest.migrations, migrations);
}

if (process.argv[1]?.endsWith('verify-release.mjs')) {
  const manifest = validateManifest(JSON.parse(readFileSync(process.argv[2], 'utf8')), { accepted: true });
  verifySource(manifest, process.argv[3]);
  console.log('PASS accepted candidate digests and exact source tree equivalence');
}
