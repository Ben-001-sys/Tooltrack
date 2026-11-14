import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const image = process.env.WEB_IMAGE ?? 'tooltrack-web:verify';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const imageId = docker('image', 'inspect', image, '--format', '{{.Id}}');
for (const id of ['staging-target', 'production-target']) {
  const upstream = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', target: id, path: req.url }));
  }).listen(0, '0.0.0.0');
  await once(upstream, 'listening');
  let container;
  try {
    container = docker('run', '-d', '--add-host', 'host.docker.internal:host-gateway',
      '-p', '127.0.0.1::3000', '-e', `API_ORIGIN=http://host.docker.internal:${upstream.address().port}`,
      '-e', 'WEB_ORIGIN=http://localhost:3000', image);
    const port = docker('port', container, '3000').split(':').at(-1);
    let result;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health?runtime=yes`);
        if (response.ok) { result = await response.json(); break; }
      } catch { /* wait for standalone server */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(result?.target, id);
    assert.equal(result?.path, '/api/v1/health?runtime=yes');
    assert.equal(docker('inspect', container, '--format', '{{.Image}}'), imageId);
    console.log(`PASS ${id} using unchanged image ${imageId}`);
  } finally {
    if (container) docker('rm', '-f', container);
    await new Promise(resolve => upstream.close(resolve));
  }
}
