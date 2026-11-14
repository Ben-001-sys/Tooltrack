import assert from 'node:assert/strict';

export async function smokeTest(base, { allowHttp = false } = {}) {
  const origin = new URL(base);
  assert.ok(origin.protocol === 'https:' || (allowHttp && ['localhost', '127.0.0.1'].includes(origin.hostname)),
    'Public smoke tests require HTTPS');
  for (const [path, statuses] of [
    ['/', [200]], ['/api/v1/health', [200]],
    ['/api/auth/get-session', [200]], ['/api/v1/session', [401]],
  ]) {
    let response;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        response = await fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(15_000),
          headers: { connection: 'close' } });
        if (statuses.includes(response.status)) break;
        await response.body?.cancel();
      } catch (error) { if (attempt === 9) throw error; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(response, `${path}: no response`);
    assert.ok(statuses.includes(response.status), `${path}: unexpected HTTP ${response.status}`);
    if (path.endsWith('/health')) assert.equal((await response.json()).status, 'ok');
    if (path.endsWith('get-session')) assert.equal(await response.json(), null, 'Anonymous session should be null');
    console.log(`PASS ${path} HTTP ${response.status}`);
  }
}

if (process.argv[1]?.endsWith('smoke-test.mjs')) {
  await smokeTest(process.env.SMOKE_BASE_URL ?? process.argv[2], { allowHttp: process.env.ALLOW_LOCAL_HTTP === 'true' });
}
