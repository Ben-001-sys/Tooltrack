# Dokploy setup

No live Dokploy resource was created: the configured connector could not resolve its admin hostname. Do not enable deployment flags until this procedure is completed and the adapter is verified against the installed server version.

## HUMAN ACTION REQUIRED — connection and resources

Platform: Dokploy, DNS provider and server. In the intended Organization, create Project `ToolTrack`, Environments `staging` and `production`, then Docker Compose resources `tooltrack-stack-staging` and `tooltrack-stack-production`. Select ordinary `docker-compose`, raw source, and paste the reviewed `deploy/dokploy/compose.yaml` exactly. Disable auto-deploy from Git. Enable Isolated Deployments; keep volume identity stable across redeploys. Set the deployment command to run Compose with health waiting (`up -d --wait --wait-timeout 180` arguments) using the installed Dokploy command UI; verify its generated full command, migration exit handling and deployment history status. Do not enable freshVolumes or destructive volume recreation.

Fill each resource's environment from `deploy/dokploy/.env.example`. `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` must be independent high-entropy secrets per environment. Use URL-safe database passwords or percent-encode the password segment in DATABASE_URL. `POSTGRES_DB` and `POSTGRES_USER` differ per environment. `WEB_ORIGIN` is that environment's HTTPS origin; API and Better Auth use the same public origin. Database host is `postgres`; browser API endpoint remains same-origin. Never paste real credentials into chat or source files.

Add a domain for service `web`, container port `3000`, path `/`, HTTPS enabled. Example staging hostname: `staging.example.com` (example only, not provisioned). Configure DNS to the actual authorized server and wait for valid TLS. Do not add public domains/ports for API or PostgreSQL. Confirm only web reaches Traefik ingress; API/migrate/PostgreSQL must not share a cross-environment network. Confirm resource-scoped postgres_data volumes differ and remain unchanged on redeploy.

Register GHCR credentials using a least-privilege read:packages credential if images are private. Verify the server can pull both exact image digests; never use latest for a deployment. Registry pull access is separate from Actions' publishing token.

Verify a fresh disposable staging stack, second migration run, migration failure blocking replacement code, container restart, network isolation, persistence, HTTPS auth registration/login/session/logout, CSRF rejection and Secure/HttpOnly/SameSite cookies in a browser. Confirm Dokploy deployment status API shapes (`deployment.allByCompose`, title/status/deploymentId) and compose/environment identity fields match the adapter. Keep logs in deployment history; redact secrets before sharing.

Codex needs afterward: working connector, installed Dokploy version, Project/Environment/Compose IDs, public origins, successful non-secret verification evidence, and confirmation secrets are stored securely. No production changes should occur during staging validation. Production setup is consequential; its first deployment requires separate explicit authorization and a verified backup.

## HUMAN ACTION REQUIRED — GitHub configuration

Repository: `Ben-001-sys/Tooltrack`, Settings → Environments → staging/production. Approval environments are created by implementation when access permits; verify required reviewers Benjamin and Emmanuel and Prevent self-review. Production/release allow only main; staging only staging. Never create deployment credentials as repository-wide secrets.

Each deployment Environment needs variables `DOKPLOY_URL` (HTTPS admin origin), `DOKPLOY_PROJECT_ID`, `DOKPLOY_ENVIRONMENT_ID`, `DOKPLOY_COMPOSE_ID`, `WEB_ORIGIN`; and Environment secret `DOKPLOY_API_KEY`. Scope keys to the smallest available project/environment permission. Staging additionally needs Environment variable `STAGING_DEPLOY_ENABLED=true` only after verification, and repository variable of the same name to turn on the CI caller. Production needs Environment variable `PRODUCTION_DEPLOY_ENABLED=true` only after its runbook is accepted. Initial flags stay absent/disabled.

Verify through Settings → Environments and a manually supervised first staging run. Supply only IDs, origins and run links afterward. Never send the API key through chat.

## HUMAN ACTION REQUIRED — final merge checks

After bootstrap workflows exist and run: Settings → Branches → protection rule for main and staging. Require PRs, one approval, dismiss stale approvals, resolved conversations, branches up to date, and checks `CI required`, `dependencies`, `secrets-and-config`. Block force pushes and deletion. Keep the documented owner emergency recovery path. The exact API configuration is `deploy/github/branch-protection.json`; validate check names from actual Actions results before applying. This affects merge eligibility, not running production.
