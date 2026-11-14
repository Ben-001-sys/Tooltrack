
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

## Project scope

The initial MVP includes authentication, tool management, predefined categories, search and filtering.

Module Links are implemented after the core application.

The dashboard is implemented last.
