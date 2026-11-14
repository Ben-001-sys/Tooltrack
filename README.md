
# ToolTrack

ToolTrack is a software tool management application.

## Technology stack

- Next.js, React and TypeScript
- NestJS and TypeScript
- PostgreSQL
- Prisma ORM
- Better Auth
- pnpm workspaces
- GitHub Actions

## Architecture

The backend uses a Medusa-inspired modular monolith.

Business modules own their data and expose public contracts.

Foreign keys are allowed within a module, but not between independently owned modules.

## Development

Required tools:

- Node.js 24
- pnpm 11.5.3 (pinned in the root manifest)
- Git

Run installation from the repository root; `pnpm-lock.yaml` is authoritative. The legacy web lockfile is retained because it contains existing developer changes; do not install independently in `apps/web`.

Copy `.env.example` to `.env`, set local-only credentials, then run:

```powershell
pnpm install --frozen-lockfile
docker compose up -d
pnpm prisma:generate
pnpm db:deploy
pnpm prisma:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev:web
pnpm dev:api
```

The frontend will use port 3000 and the backend will use port 3001.

## Collaboration

- main is the stable branch.
- Implement features in short-lived branches.
- Open pull requests for review.
- Both developers work across the full stack.
- Rotate implementation and review responsibilities.

Read [CURRENT-STATE.md](CURRENT-STATE.md) for verified progress and blockers. Features target staging after bootstrap; reviewed promotions target main. See [development/release policy](docs/DEVELOPMENT-RELEASE-POLICY.md), [pipeline architecture](docs/CI-CD-ARCHITECTURE.md), [Dokploy setup](docs/DOKPLOY-SETUP.md), [deployment runbook](docs/DEPLOYMENT-RUNBOOK.md), and [backup/restore](docs/BACKUP-RESTORE.md).

Container verification from the repository root (requires a running Docker engine):

```powershell
docker build -f apps/web/Dockerfile -t tooltrack-web:verify .
docker build -f apps/api/Dockerfile -t tooltrack-api:verify .
node --test deploy/tests/*.test.mjs
node deploy/scripts/verify-containers.mjs
node deploy/scripts/verify-runtime-targets.mjs
node deploy/scripts/verify-migration-gate.mjs
```

These scripts create only randomly named disposable test resources. Deployment uses `deploy/dokploy/compose.yaml`; the root compose file remains local-development configuration. Configure API_ORIGIN at web runtime and use the public HTTPS origin for WEB_ORIGIN and Better Auth. No staging or production deployment is enabled by default.

## Project scope

The initial MVP includes authentication, tool management, predefined categories, search and filtering.

Module Links are implemented after the core application.

The dashboard is implemented last.
