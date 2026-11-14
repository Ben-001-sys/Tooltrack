# ToolTrack implementation state

Updated 2026-11-14. No release or deployment has been claimed or performed.

## GitHub-backed Dokploy update

The latest owner decision supersedes the initial Raw Compose setup: use Dokploy's official GitHub App for source access, repository Ben-001-sys/Tooltrack, staging/main branches and `deploy/dokploy/compose.yaml`, Docker Compose, Auto Deploy OFF, Isolated Deployments ON. Owners manually configure the App, Project, Environments, resources, domains, secrets, registry access and guarded command. No connector resource creation, modification or deployment is authorized or performed for this update.

The repository adapter validates those exact settings and the immutable verifier command, rejects advanced branch heads, patches only image references and three non-secret source/hash/nonce fields, preserves unrelated environment text, and requires actual checkout/effective-Compose/digest proof from the newly created deployment. The verifier runs before Compose with read-only mounts and no network. GitHub Actions retains CI/GHCR/deployment control; approval and backup gates are unchanged. GitHub branch movement after queueing is rejected before migrations.

Nine repository-side tests pass, including real Git checkout/tamper tests and fully mocked deployment API orchestration (no Dokploy connection). Frozen install, actionlint and high-severity dependency audit pass; one moderate development advisory remains. The verifier reuses locked js-yaml 4.3.2 and adds Git to the API image. Its rebuilt Docker execution/runtime/scan checks are in progress; earlier image IDs and scan results below are the prior baseline and do not claim verification of this modified image. Installed Dokploy-version compatibility and live execution await owner setup.

## Starting repository audit

- Repository: https://github.com/Ben-001-sys/Tooltrack (public); default branch `main`.
- Fetched base: `622ef19ffc58d7969fb519272402fe26f88d88a6`.
- PRs #1–#7 merged; none open at audit. Existing remote feature branches preserved.
- No workflows, Dockerfiles, Dokploy config, branch rulesets, staging branch or GitHub Environments at audit.
- Benjamin (`Ben-001-sys`) is admin; Emmanuel (`Emmanuel-coder-prog`) has write access.
- Existing uncommitted work: `apps/web/src/app/login/` and modified `apps/web/pnpm-lock.yaml`. Excluded from implementation commits.
- Installed: Node 24.13.0, pnpm 11.5.3; frozen root installation passed.
- Lock resolves NestJS 12.4.2, Next.js 16.4.6, React 19.3.0, Prisma 7.10.1, Vitest 4.1.12.
- Two existing migrations preserved byte-for-byte. Category/Tool relationship stays inside Tool Management; auth relationships stay inside auth. Tool.userId remains scalar.
- Better Auth stays in NestJS; same-origin browser client is preserved.

## Work in progress

Review stack (none merged):

1. [PR #8: readiness](https://github.com/Ben-001-sys/Tooltrack/pull/8), `chore/ci-repository-readiness`, base staging.
2. [PR #9: runtime proxy](https://github.com/Ben-001-sys/Tooltrack/pull/9), `chore/runtime-api-proxy`, base readiness branch.
3. [PR #10: containers](https://github.com/Ben-001-sys/Tooltrack/pull/10), `chore/docker-containerization`, base proxy branch.
4. [PR #11: CI / GHCR / staging](https://github.com/Ben-001-sys/Tooltrack/pull/11), `chore/github-ci`, base container branch.
5. [PR #12: releases / production / operations](https://github.com/Ben-001-sys/Tooltrack/pull/12), `chore/release-automation`, base CI branch.

The later CI stage replaces the initial Debian images with a digest-pinned official Node 24.22.3 Alpine base in response to a failed image scan. CI pins Node 24.22.3; the local host remains 24.13.0 within the supported Node 24 range. The root lockfile changes only the documented security overrides undici 6.29.1 and tmp 0.2.7. Final Alpine image validation passed. Local Web builds include the preserved developer login page; clean GitHub CI builds exclude that uncommitted work.

GitHub changes performed: created staging at the audited baseline; protected main/staging with required review/conversation resolution and blocked force-push/deletion; created staging, release and production Environments. Release/production require Benjamin or Emmanuel with self-review prevented and allow only main; staging allows only staging. Main additionally requires up-to-date branches and `CI required`, `dependencies`, `secrets-and-config` from the GitHub Actions app. Admin emergency branch bypass remains. Staging required checks are prepared but deliberately not activated until its bootstrap workflows are reviewed/available, avoiding an unmergeable readiness PR. No deployment secrets or enable flags were provisioned.

## Verification so far

| Check | Result | Evidence / limitation |
|---|---|---|
| Repository identity/latest fetch | PASSED | GitHub metadata and authenticated git fetch |
| Existing developer work preserved | PASSED | Specific paths excluded from commits |
| Frozen install | PASSED | `pnpm install --frozen-lockfile --offline` |
| API production build | PASSED | `pnpm build:api` |
| Prisma schema / generation | PASSED | Prisma 7.10.1 validate/generate |
| Generated client runtime import | PASSED | Node import of compiled client |
| API oxlint / web ESLint | PASSED | Local commands |
| API unit tests | PASSED | 6 tests, including startup failure propagation |
| Proxy transport tests | PASSED | All verbs, runtime targets, headers, cookies, origin rejection, redirect, errors |
| Windows Next.js production build | FAILED | Turbopack CSS worker exits before connection, including unsandboxed run |
| Linux Web production build | PASSED | Initial Debian and replacement Alpine image builds; clean Ubuntu GitHub build |
| Fresh PostgreSQL migrations / status | PASSED | Disposable database on loopback 55439; both committed migrations applied |
| Compiled API auth / origin checks | PASSED | 2 integration tests; production security settings; stale logout cookie denied |
| Initial Docker / Compose lifecycle | PASSED | Both images start; migrations, proxied auth, restart, persistence and separate restore verified |
| Same Web image / two runtime upstreams | PASSED | Two Docker runs with identical image ID and different API_ORIGIN targets |
| Replacement Alpine images | PASSED | Both image builds, API Prisma/migrations/auth, Web communication and health verified |
| Private service exposure / non-root API | PASSED | API/PostgreSQL have no published ports; internal database network; API runs as node |
| Migration failure sequencing | PASSED | Deliberate exit 17 leaves API and Web stopped in a fresh disposable project |
| Workflow syntax | PASSED | actionlint 1.7.12 |
| Exact tree promotion / rejection tests | PASSED | Different commits/equal trees accepted; changed trees/migrations rejected |
| Dependency high-severity audit | PASSED | One moderate minimatch development advisory remains; no high/critical after scoped patches |
| Original Debian image scan | FAILED | 54 high/critical OS findings plus 30 bundled-tool findings; replaced, never published |
| Final Alpine image scans | PASSED | Trivy 0.76.2: zero HIGH/CRITICAL findings for both images, also passed in GitHub CI |
| GitHub PR quality/database/frontend | PASSED | Actual CI runs executed; initial image-job setup failure fixed |
| GitHub Security workflow | PASSED | Runs 43588053718, 43588332918 and 43588500802 |
| GitHub CI aggregate | PASSED | [Run 43588692297](https://github.com/Ben-001-sys/Tooltrack/actions/runs/43588692297), required aggregate and image scans green |
| Main required-check configuration | PASSED | Read back strict CI/security checks plus review protections; admin emergency bypass documented |
| Staging required-check activation | BLOCKED | Owner review/merge of bootstrap workflow PRs required first |
| GHCR publication / pull by digest | BLOCKED | Publishing requires reviewed merge to staging/main; PR jobs do not publish |
| Dokploy staging | BLOCKED | Owner performs GitHub App/resource/command/HTTPS setup and installed-version compatibility checks manually |
| Production | BLOCKED | Requires configured environment, backups and explicit human approval |

Prior-baseline local Web image ID: `sha256:001d62c9abd64d8ae168fcf2f81819aacf8995887952bcf60ceb4eb97fb30c81`. Prior-baseline local API image ID: `sha256:8672132e080f3c63cb5770c4905871b6652d773eb212039c66d234b610a81c63`. These are local verification artifacts, not published GHCR digests or release candidates. The GitHub-backed source-verifier update changes the API image and requires fresh verification.

Additional evidence: 6 API unit tests; 2 compiled API integration tests; 4 Node transport/deployment/manifest/tree tests; frozen installation after both security overrides; backend oxlint, frontend ESLint and typechecks; Prisma validate/generate/migrate deploy/status; actionlint 1.7.12; full disposable Compose lifecycle and binary-safe restore. Initial Windows Next/Turbopack failure remains reproducible/documented; Linux builds pass without changing Tailwind dependencies. All random Compose test resources are removed by their test scripts. The separately created disposable CI database is removed after verification; no real database was reset, overwritten or migrated.

Signed release manifest/bundle generation and verification are implemented using the official pinned GitHub attest action and CLI identity/ref/source policies. Actual signing, release publication and production execution remain BLOCKED until an accepted staging run and explicit approvals exist. No successful release attestation is fabricated.

## HUMAN ACTION REQUIRED

1. GitHub: Emmanuel reviews PRs #8–#12 in order. Retarget stacked PRs to staging after each predecessor merges and inspect the resulting diff. No PR has been merged by this implementation. After the workflow bootstrap is merged, apply `deploy/github/branch-protection.json` to staging and verify checks block an intentionally failing PR.
2. Dokploy: owners manually authorize the official GitHub App and configure the GitHub-backed resources per docs/DOKPLOY-SETUP.md. The earlier DNS failures are historical audit evidence; connector access is not requested or used for this update. Return only server version, resource IDs/App Names, verifier digests, public origins and non-secret setup evidence. Keep credentials in protected stores.
3. Dokploy/GHCR/GitHub Environments: complete `docs/DOKPLOY-SETUP.md` with independent secrets, isolated networks/volumes, registry pull access, HTTPS, the manually installed generated guard command and DOKPLOY_VERIFIER_IMAGE. Verify installed-version behavior, source/digest proof, migration failure propagation and actual running digests before enabling staging flags. The App's push Auto Deploy remains OFF; Actions alone initiates authorized deployments.
4. Staging/server: verify browser registration/login/session/logout, Secure/HttpOnly/SameSite cookies and CSRF over HTTPS. Configure off-server encrypted backups, test restoration and monitoring/notifications. Supply non-secret run links and backup verification references afterward.
5. Release/production: add the reviewed version changelog section and satisfy acceptance, then approve the first release and any production deployment explicitly. This has production consequences; setup alone is not deployment authorization.

Public staging HTTPS/cookies, network isolation in Dokploy, backup storage/schedule and two-release application rollback remain BLOCKED. Core Tool CRUD ownership checks and dashboard tests are NOT YET IMPLEMENTED because the corresponding application features do not exist. Nothing in the local test result claims those features or live production work.

## Resume

Use the pinned root toolchain, install at the repository root, read README and operational docs. Never use the existing local database for destructive tests. Never reset migrations or delete live volumes.
