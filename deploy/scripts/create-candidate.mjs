import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { validateManifest } from './verify-release.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const manifest = {
  schemaVersion: 1, source: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
  ciRunId: Number(process.env.GITHUB_RUN_ID),
  images: { web: process.env.WEB_IMAGE, api: process.env.API_IMAGE },
  migrations: git('ls-tree', '-r', '--name-only', 'HEAD', 'apps/api/prisma/migrations')
    .split('\n').filter(path => path.endsWith('/migration.sql')),
  tests: { quality: 'passed', database: 'passed', frontend: 'passed', containers: 'passed' },
};
validateManifest(manifest);
writeFileSync('candidate.json', JSON.stringify(manifest, null, 2) + '\n');
