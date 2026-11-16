import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from './verify-release.mjs';

export function verifyCandidateRun(runId) {
  assert.match(String(runId), /^\d+$/);
  const repository = 'Ben-001-sys/Tooltrack';
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
  const run = JSON.parse(gh('api', `repos/${repository}/actions/runs/${runId}`));
  assert.equal(run.path, '.github/workflows/ci.yml');
  assert.equal(run.event, 'push');
  assert.equal(run.head_branch, 'staging');
  assert.equal(run.head_repository.full_name, repository);
  assert.equal(run.conclusion, 'success');
  return run;
}

export function loadCandidate(runId) {
  const run = verifyCandidateRun(runId);
  const repository = 'Ben-001-sys/Tooltrack';
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
  const directory = mkdtempSync(join(tmpdir(), 'tooltrack-candidate-'));
  try {
    gh('run', 'download', String(runId), '--repo', repository, '--name', 'accepted-candidate', '--dir', directory);
    const candidate = validateManifest(JSON.parse(readFileSync(join(directory, 'accepted-candidate.json'), 'utf8')), { accepted: true });
    assert.equal(candidate.ciRunId, Number(runId));
    assert.equal(candidate.source, run.head_sha);
    return candidate;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1]?.endsWith('load-candidate.mjs')) {
  writeFileSync('accepted-candidate.json', JSON.stringify(loadCandidate(process.argv[2]), null, 2));
}
