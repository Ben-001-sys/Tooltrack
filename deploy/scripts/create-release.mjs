import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCandidate } from './load-candidate.mjs';
import { verifySource } from './verify-release.mjs';

assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Release workflow must run from protected main');
const version = process.env.RELEASE_VERSION;
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).version, version, 'Release the reviewed declared project version');
const candidate = loadCandidate(process.env.CANDIDATE_RUN_ID);
const approved = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
verifySource(candidate, approved);
const changelog = readFileSync('CHANGELOG.md', 'utf8');
assert.ok(changelog.includes(`## [${version}]`), 'Add a reviewed changelog version section before staging acceptance');
for (const image of Object.values(candidate.images)) {
  execFileSync('docker', ['buildx', 'imagetools', 'inspect', image], { stdio: 'inherit' });
}
const tag = `v${version}`;
const manifest = { ...candidate, version, tag, approvedSource: approved,
  releasedAt: new Date().toISOString(), changelog: `CHANGELOG.md#${version.replaceAll('.', '')}` };
writeFileSync('release-manifest.json', JSON.stringify(manifest, null, 2));
writeFileSync('release-notes.md', `Verified ToolTrack ${tag}\n\nSource: ${approved}\nCandidate: ${candidate.source}\nCI run: ${candidate.ciRunId}\nStaging: ${candidate.staging.url}\n\nSee the attached manifest for immutable image digests and migrations.\n\n${changelog}`);
console.log('PASS prepared release manifest; sign it before publishing');
