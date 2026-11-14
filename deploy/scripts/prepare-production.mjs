import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { verifyCandidateRun } from './load-candidate.mjs';
import { validateManifest, verifySource } from './verify-release.mjs';

const version = process.env.RELEASE_TAG;
assert.match(version, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
gh('release', 'download', version, '--repo', 'Ben-001-sys/Tooltrack',
  '--pattern', 'release-manifest.json', '--pattern', 'release-manifest.sigstore.json');
const manifest = validateManifest(JSON.parse(readFileSync('release-manifest.json', 'utf8')), { accepted: true });
assert.equal(manifest.tag, version);
assert.match(manifest.approvedSource, /^[a-f0-9]{40}$/);
gh('attestation', 'verify', 'release-manifest.json', '--bundle', 'release-manifest.sigstore.json',
  '--repo', 'Ben-001-sys/Tooltrack', '--signer-workflow', 'Ben-001-sys/Tooltrack/.github/workflows/release.yml',
  '--source-ref', 'refs/heads/main', '--source-digest', manifest.approvedSource, '--deny-self-hosted-runners');
const run = verifyCandidateRun(manifest.ciRunId);
assert.equal(manifest.source, run.head_sha);
const tagCommit = execFileSync('git', ['rev-parse', `${version}^{commit}`], { encoding: 'utf8' }).trim();
assert.equal(tagCommit, manifest.approvedSource);
verifySource(manifest, tagCommit);
for (const image of Object.values(manifest.images)) execFileSync('docker', ['buildx', 'imagetools', 'inspect', image], { stdio: 'inherit' });
console.log('PASS production release tag, candidate provenance, source and registry digests');
