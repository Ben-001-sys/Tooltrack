# Dokploy setup

The owners configure all Dokploy dashboard resources manually. Codex must not create, modify or deploy Dokploy resources through the connector. The official GitHub App is used only for source access; GitHub Actions controls deployment after validation and image publication. Do not enable deployment flags until this procedure and installed-version checks are complete.

## HUMAN ACTION REQUIRED — connection and resources

Platform: Dokploy, DNS provider and server. Manually create and authorize Dokploy's official GitHub App with access to `Ben-001-sys/Tooltrack`. Configure the following in the intended Organization:

| Field | Staging | Production |
|---|---|---|
| Project | ToolTrack | ToolTrack |
| Environment | staging | production |
| Compose resource name | tooltrack-stack-staging | tooltrack-stack-production |
| Source Type | GitHub | GitHub |
| Repository owner | Ben-001-sys | Ben-001-sys |
| Repository | Tooltrack | Tooltrack |
| Branch | staging | main |
| Compose Path | deploy/dokploy/compose.yaml | deploy/dokploy/compose.yaml |
| Compose Type | Docker Compose | Docker Compose |
| Auto Deploy | OFF | OFF |
| Isolated Deployments | ON | ON |
| Create environment file | ON | ON |
| Randomize / isolated volume renaming | OFF | OFF |
| Isolation suffix | blank or actual App Name | blank or actual App Name |

Do not paste Raw Compose into the source editor. Do not configure a Git push deployment webhook or enable Auto Deploy. Keep PostgreSQL volumes stable and never enable freshVolumes as a normal deployment operation. Image publication can run after reviewed bootstrap merges while deployment flags remain disabled.

## Install the checkout guard manually

Dokploy's inspected GitHub provider clones a branch at deployment time; its Compose deploy API does not accept an immutable source SHA. A GitHub branch-head check alone cannot close a queued-deployment race. The manually configured Advanced Command must run the immutable verifier before Compose. The Actions adapter validates this exact command and never rewrites it or changes the GitHub provider configuration.

After the updated API image is published and tested, choose its immutable GHCR digest as the verifier image. It contains the Node checkout guard, Git and the already locked js-yaml parser. Set the non-secret GitHub Environment variable `DOKPLOY_VERIFIER_IMAGE` to that API digest in each environment. Retain this pinned verifier image; update it only after review and testing. The app/migration API_IMAGE can subsequently advance independently.

Find the resource's actual Dokploy **App Name** (the generated identifier, which can differ from its display name). From a checkout with the pinned root dependencies installed, generate the exact Advanced Command:

```powershell
node deploy/scripts/dokploy-command.mjs ACTUAL_DOKPLOY_APP_NAME ghcr.io/ben-001-sys/tooltrack-api@sha256:VERIFIED_API_DIGEST
```

Replace both argument values with actual non-secret identifiers. This command only prints configuration; it does not contact Dokploy. Paste its output into Advanced → Command manually. Dokploy adds the leading `docker`; do not add another leading docker to the generated value. The command uses a read-only, network-disabled verifier container, three read-only mounts (Git metadata, generated Compose, generated deployment env), then `&& docker compose ... --env-file deploy/dokploy/.env ... up -d --wait --pull always`. Never remove the verifier to work around a failure. Use only resource-scoped deployment variables; do not export app deployment keys into the Dokploy worker's global host environment where shell precedence could override Compose's explicit env file.

The verifier checks actual Git HEAD against the approved revision, hashes the committed Compose bytes, checks the generated file with only inspected Dokploy ingress/metadata transformations allowed, and validates the image digests and per-deployment nonce in the env file. Other secrets are neither printed nor placed in Docker command arguments/container environment. The proof line contains only non-secret revision/hash/nonce/image references. Actions requires that exact proof from the newly created deployment before marking acceptance.

Compatibility research used Dokploy source revision `42fe79c9c0a6c1559acad4945ed11626cb99b1dd`: [Compose command handling](https://github.com/Dokploy/dokploy/blob/42fe79c9c0a6c1559acad4945ed11626cb99b1dd/packages/server/src/utils/builders/compose.ts), [GitHub clone](https://github.com/Dokploy/dokploy/blob/42fe79c9c0a6c1559acad4945ed11626cb99b1dd/packages/server/src/utils/providers/github.ts), and [isolated networking](https://github.com/Dokploy/dokploy/blob/42fe79c9c0a6c1559acad4945ed11626cb99b1dd/packages/server/src/utils/docker/collision/root-network.ts). Verify your installed version supports safe `&& docker compose` command chaining, the relative read-only mounts, metadata transformation and log API shape. Unsupported versions fail closed; do not assume the inspected source is your installed version.

Fill each resource's environment from `deploy/dokploy/.env.example`. `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` must be independent high-entropy secrets per environment. Use URL-safe database passwords or percent-encode the password segment in DATABASE_URL. `POSTGRES_DB` and `POSTGRES_USER` differ per environment. `WEB_ORIGIN` is that environment's HTTPS origin; API and Better Auth use the same public origin. Database host is `postgres`; browser API endpoint remains same-origin. Never paste real credentials into chat or source files.

Add a domain for service `web`, container port `3000`, path `/`, HTTPS enabled. Example staging hostname: `staging.example.com` (example only, not provisioned). Configure DNS to the actual authorized server and wait for valid TLS. Do not add public domains/ports for API or PostgreSQL. Confirm only web reaches Traefik ingress; API/migrate/PostgreSQL must not share a cross-environment network. Confirm resource-scoped postgres_data volumes differ and remain unchanged on redeploy.

Register GHCR credentials using a least-privilege read:packages credential if images are private. Verify the server can pull both exact image digests; never use latest for a deployment. Registry pull access is separate from Actions' publishing token.

Verify a fresh disposable staging stack, second migration run, migration failure blocking replacement code, container restart, network isolation, persistence, HTTPS auth registration/login/session/logout, CSRF rejection and Secure/HttpOnly/SameSite cookies in a browser. Confirm Dokploy deployment status API shapes (`deployment.allByCompose`, title/status/deploymentId) and compose/environment identity fields match the adapter. Keep logs in deployment history; redact secrets before sharing.

Codex needs afterward: installed Dokploy version, Project/Environment/Compose IDs, actual App Names, chosen verifier image digests, public origins, non-secret verification evidence, and confirmation secrets are stored securely. No connector resource actions are authorized. No production changes should occur during staging validation. The first production deployment requires separate explicit authorization and a verified backup.

## HUMAN ACTION REQUIRED — GitHub configuration

Repository: `Ben-001-sys/Tooltrack`, Settings → Environments → staging/production. Approval environments are created by implementation when access permits; verify required reviewers Benjamin and Emmanuel and Prevent self-review. Production/release allow only main; staging only staging. Never create deployment credentials as repository-wide secrets.

Each deployment Environment needs variables `DOKPLOY_URL` (HTTPS admin origin), `DOKPLOY_PROJECT_ID`, `DOKPLOY_ENVIRONMENT_ID`, `DOKPLOY_COMPOSE_ID`, `DOKPLOY_VERIFIER_IMAGE`, `WEB_ORIGIN`; and Environment secret `DOKPLOY_API_KEY`. Scope keys to the smallest available project/environment permission. The workflow token reads GitHub branch provenance; it is not the Dokploy GitHub App credential. Actions only patches WEB_IMAGE, API_IMAGE and its three reserved TOOLTRACK_SOURCE_REVISION / TOOLTRACK_COMPOSE_SHA256 / TOOLTRACK_DEPLOYMENT_NONCE fields. All unrelated environment text is preserved. Do not hand-edit those reserved fields or run a concurrent dashboard deployment.

Staging additionally needs Environment variable `STAGING_DEPLOY_ENABLED=true` only after verification, and repository variable of the same name to turn on the CI caller. Production needs Environment variable `PRODUCTION_DEPLOY_ENABLED=true` only after its runbook is accepted. Initial flags stay absent/disabled. Existing GitHub Environment/peer approval policies remain in force; the GitHub App must not bypass them.

Verify through Settings → Environments and a manually supervised first staging run. Supply only IDs, origins and run links afterward. Never send the API key through chat.

## HUMAN ACTION REQUIRED — final merge checks

Main already has the final required-check configuration; staging has the bootstrap review protections. After staging's bootstrap workflows are merged: Settings → Branches → protection rule for staging. Require PRs, one approval, dismiss stale approvals, resolved conversations, branches up to date, and checks `CI required`, `dependencies`, `secrets-and-config`. Block force pushes and deletion. Keep the documented owner emergency recovery path. The exact API configuration is `deploy/github/branch-protection.json`; check names were verified from actual Actions jobs. Verify both branch rules after bootstrap. This affects merge eligibility, not running production.
