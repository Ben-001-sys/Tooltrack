# Development and release policy

Benjamin and Emmanuel share frontend, backend and operations responsibilities. Feature branches start from `staging` after the bootstrap PRs are reviewed and merged. Use `feature/*`, `fix/*`, `chore/*`, or `hotfix/*`. One developer implements; the other reviews. Resolve conversations and rerun stale checks before merging. Keep PRs small and record commands, outcomes, secrets required, migration compatibility, and rollback limits.

`staging` integrates reviewed work. `main` contains approved production source. Promote with a reviewed staging-to-main PR. CI's `CI required` aggregate includes lint, types, unit/transport tests, fresh migrations, compiled API auth tests, frontend compilation, container builds, container auth, restore/restart and runtime-target checks. Security checks `dependencies` and `secrets-and-config` also become mandatory after bootstrap. Admin emergency bypass is retained to avoid lockout; document any use as an incident, never as routine workflow.

## Bootstrap order

1. Review and merge readiness PR #8 into staging.
2. Review subsequent proxy, container/CI and release/operations PRs in dependency order. Stacked PR bases must be retargeted to staging after their predecessor is merged; do not squash a dependency and then merge duplicate commits without inspecting the diff.
3. After workflow PRs run successfully, apply `deploy/github/branch-protection.json` to both long-lived branches. Verify actual emitted check names in the PR before applying. The initial applied protections deliberately omit status checks because the baseline has no workflows.
4. Promote the reviewed workflow implementation to main. Manual release workflows are discoverable when on the default branch.
5. Finish staging setup and verification before setting the repository variable `STAGING_DEPLOY_ENABLED=true`.

## Releases

Use SemVer. Version `0.1.0` is a declared development version, not an existing release. Add a reviewed `## [0.1.0]` changelog section when acceptance criteria are met; do not invent release history. Dispatch Release from main with version and a successful staging CI run ID. The run must be a repository push to staging, use `ci.yml`, have successful conclusion, and contain HTTPS staging acceptance. The source Git tree must exactly equal the approved main tree, even if merge commit SHAs differ. Mismatches require another build and staging validation. The release records both SHAs, the tree, immutable images, migration paths, CI run and staging result. No image is rebuilt for the tag.

Release and production Environments require approval by the other developer. Production additionally requires manual workflow dispatch, `approve-production=true`, `PRODUCTION_DEPLOY_ENABLED=true`, and a backup reference verified within 24 hours. No automatic production trigger is installed. Future automation must replace this explicit dispatch policy in the same workflow through a reviewed policy change; do not add a second competing deploy mechanism.

## Hotfixes

Branch from the current production main revision, isolate the fix, verify it, and merge its reviewed PR into main. Use an isolated candidate branch/environment workflow extension reviewed by both maintainers, or temporarily stage only the hotfix baseline, before obtaining staging acceptance. The current candidate loader accepts staging push runs only; it intentionally refuses a shortcut that would ship unrelated incomplete staging features. Back-merge the approved fix into staging. Do not tag or deploy an untested hotfix.

## Freeze and resume

Before pausing, record deployed release, image digests, source SHA, migration state, last successful backup/restore, working functionality, open PRs, issues, and next development slice in CURRENT-STATE.md. Retain GHCR images and release manifest; copy accepted-candidate evidence off Actions before its 90-day retention expires. Existing releases cannot be newly promoted after required acceptance artifacts expire; create a newly verified candidate or implement reviewed durable evidence archival. Running deployments continue to operate.

Resume by reading CURRENT-STATE.md, cloning, installing Node/pnpm pins, restoring local configuration through a secure store, starting local PostgreSQL, running frozen install, Prisma generation and migrations, then lint/types/tests/build. Check the deployed release before changing schema. Dashboard remains last; Module Links follow core MVP.
