const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'];

function origin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Expected an HTTP(S) origin without credentials or a path');
  }
  return url.origin;
}

function cleanHeaders(input) {
  const headers = new Headers(input);
  const connectionTokens = (headers.get('connection') ?? '').split(',');
  for (const name of [...hopByHop, ...connectionTokens]) {
    if (name.trim()) headers.delete(name.trim());
  }
  return headers;
}

/** Only these two namespaces can reach the single operator-configured upstream. */
export async function proxyApi(request) {
  const incoming = new URL(request.url);
  if (!/^\/api\/(auth|v1)(\/|$)/.test(incoming.pathname)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  let upstream;
  let publicOrigin;
  try {
    upstream = origin(process.env.API_ORIGIN ?? 'http://127.0.0.1:3001');
    if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
      throw new Error('WEB_ORIGIN is required in production');
    }
    publicOrigin = origin(process.env.WEB_ORIGIN ?? incoming.origin);
  } catch {
    return Response.json({ error: 'Invalid proxy configuration' }, { status: 503 });
  }
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const suppliedOrigin = request.headers.get('origin');
  if (!safeMethod && suppliedOrigin && suppliedOrigin !== publicOrigin) {
    return Response.json({ error: 'Untrusted origin' }, { status: 403 });
  }
  // Construct from a validated origin; never resolve a client URL against it.
  const target = new URL(upstream);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = cleanHeaders(request.headers);
  for (const name of [...headers.keys()]) {
    if (name === 'host' || name === 'forwarded' || name.startsWith('x-forwarded-') ||
        name === 'content-length' || name === 'accept-encoding') headers.delete(name);
  }
  const external = new URL(publicOrigin);
  headers.set('x-forwarded-host', external.host);
  headers.set('x-forwarded-proto', external.protocol.slice(0, -1));
  // Forward Origin unchanged so Nest/Better Auth can enforce CSRF checks.
  headers.set('accept-encoding', 'identity');
  try {
    const response = await fetch(target, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: 'half', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    const outgoing = cleanHeaders(response.headers);
    outgoing.delete('content-length');
    outgoing.delete('content-encoding'); // fetch has already decompressed the stream
    outgoing.delete('set-cookie');
    for (const cookie of response.headers.getSetCookie()) outgoing.append('set-cookie', cookie);
    const location = outgoing.get('location');
    if (location) {
      const redirect = new URL(location, target);
      if (redirect.origin === upstream) {
        outgoing.set('location', `${publicOrigin}${redirect.pathname}${redirect.search}${redirect.hash}`);
      }
    }
    outgoing.set('cache-control', 'private, no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status, statusText: response.statusText, headers: outgoing,
    });
  } catch {
    return Response.json({ error: 'API unavailable' }, {
      status: 502, headers: { 'cache-control': 'no-store' },
    });
  }
}
