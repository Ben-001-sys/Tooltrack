import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../scripts/verify-release.mjs';
const candidate = () => ({ schemaVersion: 1, source: 'a'.repeat(40), tree: 'b'.repeat(40), ciRunId: 1,
  images: { web: `ghcr.io/ben-001-sys/tooltrack-web@sha256:${'c'.repeat(64)}`,
    api: `ghcr.io/ben-001-sys/tooltrack-api@sha256:${'d'.repeat(64)}` },
  migrations: ['apps/api/prisma/migrations/init/migration.sql'],
  staging: { status: 'passed', source: 'a'.repeat(40), url: 'https://staging.example.com', verifiedAt: new Date().toISOString() },
});
test('release refuses mutable images, missing staging acceptance and source substitution', () => {
  validateManifest(candidate(), { accepted: true });
  for (const mutate of [c => { c.images.web = 'ghcr.io/ben-001-sys/tooltrack-web:latest'; },
    c => { delete c.staging; }, c => { c.staging.source = 'e'.repeat(40); },
    c => { c.staging.url = 'http://staging.example.com'; }]) {
    const value = candidate(); mutate(value);
    assert.throws(() => validateManifest(value, { accepted: true }));
  }
});
