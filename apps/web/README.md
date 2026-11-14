This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Use the repository's Node 24 pin and pnpm 11.5.3. Install from the repository root with `pnpm install --frozen-lockfile`; the root lockfile is authoritative. Preserve the legacy nested lockfile until its existing developer edits are reconciled.

From the repository root, run the development server:

```bash
pnpm dev:web
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file. Use `pnpm build:web` for production compilation and the root lint/typecheck/test commands for verification.

The browser uses `/api/auth/*` and `/api/v1/*` on the same origin. Route Handlers select the backend through runtime `API_ORIGIN`; production also requires `WEB_ORIGIN`. Better Auth stays inside NestJS. See [pipeline architecture](../../docs/CI-CD-ARCHITECTURE.md).

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

ToolTrack uses a standalone Docker image and the approved [GitHub/Dokploy deployment runbook](../../docs/DEPLOYMENT-RUNBOOK.md). Public staging and production setup remain separate, with production approval required.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
