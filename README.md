
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

## Tool ownership inside collections

My Tools creates personal tools (`userId` set, `collectionId` null). Linking an existing personal tool through **Add Existing Tool** keeps that ownership: removing its link or deleting the collection never deletes the personal tool. Existing collection summaries continue to hide personal department tags and private notes; public summaries also strip URL credentials, query strings and fragments.

Open My Collections or Explore Collections, select a collection, and choose **Create New Tool** to use the existing two-step form with categories and department tags. This creates a Tool with `userId` null and the authorized collection's scalar `collectionId`. It creates no Module Link, never appears in any user's My Tools inventory, and survives deletion of the contributing user's personal records or account. Collection-owned tools show Details, Edit and permanent Delete actions; linked personal tools show Remove from Collection. Counts include both kinds.

The existing collection tool-list endpoints return both kinds with `ownership: "COLLECTION" | "PERSONAL_LINK"`. Collection-owned creation uses `POST /api/v1/collections/:id/owned-tools`; Details, editing and permanent deletion use `GET`, `PATCH` and `DELETE /api/v1/collections/:id/owned-tools/:toolId`. All routes validate UUIDs and use authenticated collection permissions; request bodies cannot set ownership.

Private collection-owned tools are owner-only. Any authenticated user can read, create, edit and delete tools in a public collection. Anonymous access remains forbidden, and only the collection owner can change visibility. Privatization revokes other users on subsequent requests without changing the tools. Shared tool descriptions and tags are visible to authorized members; collection-owned API responses sanitize website credentials, query strings and fragments like public personal-link summaries.

Tools owns Tool, Category, Tag and ToolTag records; Collections owns Collection; Links owns personal associations. There are no cross-module foreign keys. The coordinator checks collection permissions and holds its row lock for the entire Tool operation. Collection deletion uses public service methods in one transaction to delete owned tools (cascading ToolTag rows) and links, while keeping personal tools, categories and tags.

Apply `20261124120000_add_collection_owned_tools` through the existing migration gate before running this version. It adds nullable scalar `collectionId`, makes `userId` nullable, adds an index and enforces exactly one owner with PostgreSQL CHECK `tools_exactly_one_owner`. Existing tools remain personal, and existing links and accounts are preserved. Use normal reviewed staging/release approval and off-server backup requirements; the v0.1.4 no-backup exception does not apply to a later release. No production migration is performed by this feature's development tests.

Rollback should normally be a forward fix. An older API cannot safely delete collections containing owned tools, and the old non-null user schema cannot represent them. Do not drop the ownership column, discard owned tools or restore the old constraint after writes. Any downgrade/data recovery needs a separately reviewed preservation and reconciliation plan and verified backup; this change does not implement transfers or automatic rollback.

## Department tags

A tool has one category and can have several tags. Department tags describe where software is used. Collections group saved tools independently of their categories and tags.

In My Tools, open **Department Tags** during the details step of Add Tool or when editing. Search by department name and select or clear any checkboxes. Cards show up to two badges and an overflow count. Tool Details shows all attached tags. **Filter by department** matches any selected department and applies together with search, category and access-type filters. Filters run on the tools loaded by the page. The API list returns at most the 100 most recently created tools.

Tool Management owns the `Tag` catalog and the `ToolTag` junction. Each tool/tag pair is unique. Deleting a tool cascades to its junction rows and preserves the shared tags. Tool owners receive their tag assignments through the authenticated Tools API. Personal-link collection summaries omit tag assignments. Collection-owned tools expose their shared tags to authorized collection members.

The existing Prisma seed upserts all 18 CETECH departments as system-managed `DEPARTMENT` tags and keeps the eight default categories. For local setup, apply migrations with `pnpm db:deploy`, then run `pnpm --dir apps/api exec prisma db seed`. The deployment initializer already runs the seed after a successful migration. Additional tags can be inserted through a controlled seed or administrative process using a unique, stable lowercase slug. Adding a tag row requires no schema migration, and the Department Tags picker displays only `DEPARTMENT` entries.

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
node deploy/scripts/verify-checkout-container.mjs
```

These scripts create only randomly named disposable test resources. Dokploy reads `deploy/dokploy/compose.yaml` through its official GitHub App, with Auto Deploy OFF; Actions alone controls deployment. Owners manually configure the dashboard and guarded command described in the setup guide. The root compose file remains local-development configuration. Configure API_ORIGIN at web runtime and use the public HTTPS origin for WEB_ORIGIN and Better Auth. No staging or production deployment is enabled by default.

## Project scope

The initial MVP includes authentication, tool management, predefined categories, search and filtering.

Module Links are implemented after the core application.

The dashboard is implemented last.
