# CI/CD architecture

The NestJS modular monolith owns authentication, sessions and authorization. Next.js serves pages and proxies `/api/auth/*` and `/api/v1/*` on the public origin. PostgreSQL remains private. The root lockfile and pinned pnpm govern installation; the legacy nested web lockfile contains pre-existing developer changes and is preserved for reconciliation.

## Build and promotion

CI validates quality, disposable PostgreSQL migrations and compiled API auth, and frontend production compilation. Read-only image verification runs on PRs. Only trusted pushes to staging/main can enter the separate publishing invocation with packages write permission. That invocation builds and tests its own images, scans them, then pushes the exact loaded images with `sha-<full SHA>` tags. Build caches avoid repeated compilation; the final candidate is the tested publishing invocation's pair. PR jobs never receive registry or deployment credentials.

The reusable build workflow inherits permissions from its caller. Do not add a direct privileged PR trigger or `pull_request_target`. Inputs never select arbitrary code revisions. Checkout uses the event revision, not a moving branch. Actions are pinned to resolved commit SHAs. Dependabot proposes updates for human review.

Publishing creates `candidate.json` with schemaVersion=1, source, tree, ciRunId, images.web/api digest references, migration paths and passed checks. A successful staging deployment adds staging.source/status/url/verifiedAt/deploymentId and uploads `accepted-candidate.json`. Release re-downloads acceptance from a validated GitHub run, checks source-tree equality and registry availability, signs the resulting manifest using GitHub OIDC artifact attestation, then creates a non-forced Git tag and durable release assets. Production verifies the manifest's Sigstore bundle, exact repository/release-workflow identity, main source ref and approved source digest, original CI run metadata, tag and main ancestry. This preserves recovery after CI artifact expiry. No tag-triggered image rebuild exists. Actual signing awaits the first approved release and is not claimed as executed.

## Runtime proxy

`API_ORIGIN` is read for each request. `WEB_ORIGIN` is required in production and defines forwarded public host/protocol. Configuration must be a bare HTTP(S) origin with no credentials, path, query or fragment. Targets come exclusively from that configuration; only two fixed path namespaces are proxied. Rewrites were removed because Next config is serialized at build time. The installed Next.js 16.4.6 docs describe request-dependent Route Handlers and standalone output tracing; Cache Components is preserved and Node is the default runtime.

The proxy streams bodies and responses, preserves query strings, content types, status and independent Set-Cookie headers, does not follow redirects, and rewrites redirects to the internal upstream back to the public origin. Hop-by-hop headers and client-supplied forwarded host/protocol/IP are stripped. Origin and cookies are preserved for Better Auth checks, with an additional same-origin mutation check. Fetch responses are never cached; content-length/encoding are removed after fetch decompression. Upstream failures return 502 without exposing internal URLs or secrets. Timeouts are 30 seconds. Large-file uploads and WebSocket upgrades are outside current MVP acceptance; add deliberate limits/stream cancellation tests before introducing them.

Client IP headers are intentionally stripped until Traefik ingress trust is configured and verified. Better Auth can therefore share a rate-limit bucket behind the proxy. Configure a trusted ingress-only IP forwarding design before public traffic exceeds MVP usage; do not blindly trust browser-supplied X-Forwarded-For.

## Option A

Create one Docker Compose resource per Dokploy Environment. Compose project-scoped networks and volumes isolate PostgreSQL. Only web receives a domain/Traefik route. In the source file, API joins application and database networks, while PostgreSQL and migrate join the internal database network. No service publishes a host port. Dokploy adds its resource-specific isolated network during conversion, as described below. Do not attach private services to globally shared Dokploy networks. Verify connectivity and retain stable volume identity.

Source access uses the official Dokploy GitHub App, repository `Ben-001-sys/Tooltrack`, branch staging/main and path `deploy/dokploy/compose.yaml`; Auto Deploy stays OFF. Owners configure resources manually; Codex does not operate them through the connector. Actions validates/publishes images and alone requests deployment through the protected workflow. The resource's manually installed command runs a pinned verifier image before Compose. Actions rejects a stale GitHub ref before mutation; the verifier then closes the clone/queue race by checking actual HEAD, approved Git-blob SHA-256, generated Compose content and env-file digest/nonce authorization. It allows only Dokploy ingress-network and metadata changes. This adds Git and the already locked js-yaml 4.3.2 parser to the API/verifier image; no application dependency is upgraded.

The inspected Dokploy version attaches its resource-specific isolated network to all services. This network is distinct between environments; it is not a shared global ingress network. No private service may acquire Traefik routing labels or published ports. The guard preserves the private database network and rejects cross-environment or arbitrary network additions. Server-version compatibility remains a manual setup prerequisite.

The one-off migrate service runs the API image's Prisma CLI with committed schema/config/history. PostgreSQL health precedes migration; successful migration precedes API startup; API health precedes web. Deployment status plus HTTPS smoke checks are required. A failed migration must fail Compose and Dokploy; never count existing old-container health as a successful rollout. Instance-specific command/status compatibility is BLOCKED until the Dokploy connection works.

API runtime retains build dependencies to safely reuse the image for Prisma migration tooling; this increases size and vulnerability surface. Image scanning gates publication. A later dedicated migration target plus a pruned runtime can reduce that surface without changing migration history. No secrets enter Docker build context.

## References consulted

- Installed Next.js docs: `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `03-api-reference/05-config/01-next-config-js/output.md`.
- [Prisma 7 generators](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators) and [CLI](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference).
- [Docker startup ordering](https://docs.docker.com/compose/how-tos/startup-order/).
- [Dokploy Compose API](https://docs.dokploy.com/docs/api/compose) and [isolated deployments](https://docs.dokploy.com/docs/core/docker-compose/utilities).
- [GitHub protected deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Dokploy server version and live API response shapes could not be checked because DNS access failed. The adapter uses the documented endpoints and fails closed on unexpected resource identity or response shape. Its live integration remains unverified.
