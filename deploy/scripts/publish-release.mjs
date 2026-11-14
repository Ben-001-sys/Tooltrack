import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, copyFileSync } from 'node:fs';
import { validateManifest } from './verify-release.mjs';

assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
const manifest = validateManifest(JSON.parse(readFileSync('release-manifest.json', 'utf8')), { accepted: true });
assert.match(manifest.tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
assert.match(manifest.approvedSource, /^[a-f0-9]{40}$/);
copyFileSync(process.env.ATTESTATION_BUNDLE, 'release-manifest.sigstore.json');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
gh('attestation', 'verify', 'release-manifest.json', '--bundle', 'release-manifest.sigstore.json',
  '--repo', 'Ben-001-sys/Tooltrack', '--signer-workflow', 'Ben-001-sys/Tooltrack/.github/workflows/release.yml',
  '--source-ref', 'refs/heads/main', '--source-digest', manifest.approvedSource, '--deny-self-hosted-runners');
const refPath = `repos/Ben-001-sys/Tooltrack/git/ref/tags/${manifest.tag}`;
let existing;
try { existing = JSON.parse(gh('api', refPath)); }
catch (error) {
  // Retry an interrupted publication only if the ref is genuinely absent.
  if (!String(error.stderr).includes('404')) throw error;
}
if (existing) assert.equal(existing.object.sha, manifest.approvedSource, 'Never move an existing release tag');
else gh('api', 'repos/Ben-001-sys/Tooltrack/git/refs', '-f', `ref=refs/tags/${manifest.tag}`, '-f', `sha=${manifest.approvedSource}`);
gh('release', 'create', manifest.tag, '--repo', 'Ben-001-sys/Tooltrack', '--verify-tag',
  '--title', `ToolTrack ${manifest.tag}`, '--notes-file', 'release-notes.md',
  'release-manifest.json', 'release-manifest.sigstore.json');
