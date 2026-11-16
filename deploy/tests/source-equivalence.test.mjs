import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySource } from '../scripts/verify-release.mjs';

test('different commits with equal trees promote; changed source or migrations are refused', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tooltrack-provenance-'));
  const previous = process.cwd();
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Disposable provenance test');
    git('config', 'user.email', 'test@example.com');
    mkdirSync(join(directory, 'apps/api/prisma/migrations/init'), { recursive: true });
    writeFileSync(join(directory, 'apps/api/prisma/migrations/init/migration.sql'), 'SELECT 1;\n');
    git('add', '.'); git('commit', '-qm', 'candidate');
    const source = git('rev-parse', 'HEAD');
    const tree = git('rev-parse', 'HEAD^{tree}');
    git('commit', '--allow-empty', '-qm', 'equivalent promotion');
    const approved = git('rev-parse', 'HEAD');
    assert.notEqual(source, approved);
    git('update-ref', 'refs/remotes/origin/main', approved);
    const manifest = { source, tree, migrations: ['apps/api/prisma/migrations/init/migration.sql'] };
    process.chdir(directory);
    verifySource(manifest, approved);
    assert.throws(() => verifySource({ ...manifest, migrations: [] }, approved));
    writeFileSync(join(directory, 'changed.txt'), 'unverified source');
    git('add', '.'); git('commit', '-qm', 'changed production source');
    const changed = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', changed);
    assert.throws(() => verifySource(manifest, changed), /differs from tested staging source/);
  } finally { process.chdir(previous); rmSync(directory, { recursive: true, force: true }); }
});
