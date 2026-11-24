import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

test('architecture checker scans real module folders and rejects private imports, cross-module FKs and missing folders', () => {
  const temporaryRoot = resolve(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, 'tooltrack-architecture-'));
  try {
    for (const module of ['tools', 'collections', 'links', 'auth']) mkdirSync(join(root, 'apps/api/src', module), { recursive: true });
    mkdirSync(join(root, 'apps/api/prisma'), { recursive: true });
    copyFileSync('deploy/scripts/architecture-check.mjs', join(root, 'check.mjs'));
    const schema = readFileSync('apps/api/prisma/schema.prisma', 'utf8');
    const schemaPath = join(root, 'apps/api/prisma/schema.prisma');
    const source = join(root, 'apps/api/src/tools/fixture.ts');
    writeFileSync(schemaPath, schema);
    writeFileSync(source, "import { CollectionsService } from '../collections/index.js';");
    const check = () => spawnSync(process.execPath, ['check.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(check().status, 0);
    writeFileSync(source, "import { CollectionsService } from '../collections/collections.service.js';");
    const privateImport = check();
    assert.notEqual(privateImport.status, 0);
    assert.match(privateImport.stderr, /Private cross-module import/);
    writeFileSync(source, "import { CollectionsService } from '../collections/index.js';");
    writeFileSync(schemaPath, schema.replace('model Tool {', 'model Tool {\n  forbidden Collection @relation(fields: [collectionId], references: [id])'));
    const foreignKey = check();
    assert.notEqual(foreignKey.status, 0);
    assert.match(foreignKey.stderr, /Cross-module relationship Tool -> Collection/);
    writeFileSync(schemaPath, schema);
    rmdirSync(join(root, 'apps/api/src/auth'));
    assert.notEqual(check().status, 0);
  } finally {
    assert.equal(dirname(root), temporaryRoot);
    rmSync(root, { recursive: true, force: true });
  }
});
