# Changelog

No official ToolTrack release has been created by this implementation.

## [Unreleased]

- Pin root Node/pnpm toolchain and document reproducible installation.
- Replace build-time API rewrites with a runtime origin proxy, preserving NestJS authentication authority.
- Add standalone Web and API Dockerfiles and isolated Dokploy Compose configuration.
- Add CI, fresh migration/auth verification, container lifecycle and restore checks.
- Add GHCR candidate publishing, source-equivalent release promotion and approval-gated production workflow.
- Preserve signed release manifests and provenance bundles as durable release assets for recovery after CI artifact expiration.
- Patch deployment-helper transitive vulnerabilities and move runtime images to digest-pinned Node 24.22.3 Alpine after scan failures.
- Add dependency/container/secret checks, deployment safeguards and operational documentation.
- Preserve existing login development, authentication and migration history.

Add a reviewed version section before staging a release candidate; Unreleased is not a released version.
