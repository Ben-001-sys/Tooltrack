
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
- pnpm 10
- Git

After both applications have been initialized and their dependencies installed:

```powershell
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
