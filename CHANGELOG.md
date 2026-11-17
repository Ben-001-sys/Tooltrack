# Changelog

## [Unreleased]

## [0.1.2]

- Permit **only** previous Dokploy deployments with a known `error` status during the first-production bootstrap check; never delete or rewrite deployment history.
- Still reject any successful, cancelled, active or unrecognized deployment record, and reject pre-existing PostgreSQL volumes and project containers before environment changes.
- Make failed Docker inventory queries and unexpected inventory formats return sanitized failure categories without exposing credentials or server responses.
- Keep the production approval, signed release, one-time initial deployment mode and ordinary-upgrade backup requirements unchanged.

## [0.1.1]

- Add a manually authorized initial-production deployment mode that skips the existing-database backup requirement **only** after checking Dokploy deployment history and the target Docker host for pre-existing Compose containers and persistent database volumes.
- Fail closed when Docker inventory cannot be read or the expected clean state cannot be verified.
- Keep ordinary production upgrades subject to a genuine off-server backup verified within 24 hours; do not alter or automatically remove any volume.
- Preserve peer approval, immutable image provenance, source verification and HTTPS acceptance for initial deployments.

## [0.1.0]

### Included in the initial release candidate

- Pin root Node/pnpm toolchain and document reproducible installation.
- Replace build-time API rewrites with a runtime origin proxy, preserving NestJS authentication authority.
- Add standalone Web and API Dockerfiles and isolated Dokploy Compose configuration.
- Add CI, fresh migration/auth verification, container lifecycle and restore checks.
- Add GHCR candidate publishing, source-equivalent release promotion and approval-gated production workflow.
- Preserve signed release manifests and provenance bundles as durable release assets for recovery after CI artifact expiration.
- Patch deployment-helper transitive vulnerabilities and move runtime images to digest-pinned Node 24.22.3 Alpine after scan failures.
- Add dependency/container/secret checks, deployment safeguards and operational documentation.
- Preserve existing login development, authentication and migration history.
- Use the official Dokploy GitHub App for source access with push Auto Deploy disabled; verify the actual checkout and generated Compose before Actions-controlled deployment.
- Add immutable verifier command generation, source-race/tamper tests, secret-preserving image/proof updates and manual GitHub-backed setup instructions.
- Add authenticated ToolTrack registration, login/session handling, protected Tools page, and per-user Tool create, list, view, edit and delete APIs.
- Add categories, tool access-type filtering, search, and a shadcn/ui tool-entry dialog.
- Add personal Collections with create, list, view, edit and delete operations, plus association and removal of existing tools in a collection.
- Complete the first GitHub-controlled staging deployment with immutable GHCR image digests, verified checkout and generated Compose, and public HTTPS acceptance (CI run 43748556621, attempt 3).
- Document operational fixes discovered during staging: exact Dokploy Compose path, working upstream DNS/Let's Encrypt, and category seeding.

### Known limitations and follow-up operations

- The Dashboard remains future work; this release candidate covers authenticated tool and collection management.
- Initial category records currently require the idempotent Prisma seed; automated production initialization remains follow-up work.
- Server DNS corrections were applied at runtime during staging validation and need persistent configuration before relying on certificate renewal.
- Better Auth proxy client-IP forwarding still requires trusted-proxy configuration.
- The live production environment, independently verifiable off-server database backup/restore, and first release/production deployment have not yet been approved or completed.
