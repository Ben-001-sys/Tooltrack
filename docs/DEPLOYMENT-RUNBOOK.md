# Deployment runbook

Read CURRENT-STATE.md first. There is no verified live ToolTrack deployment or official release yet. Application functionality currently includes registration, backend auth/session endpoints and health; Tool CRUD, ownership filtering and dashboard acceptance are future work. Existing developer login UI is outside the implementation commits until its owner reviews it.

## Staging

Merge only reviewed, green changes into staging. CI validates source, builds/tests/scans images, pushes SHA tags and records digests. When enabled, its staging job uses protected Environment credentials. The adapter confirms the manually configured GitHub App provider, repository, staging/main branch, Compose path, resource/environment/project IDs, isolation, disabled Auto Deploy and exact guarded command. It patches only immutable image references and three reserved source/hash/nonce fields, preserving unrelated environment assignments. Concurrent dashboard edits stop deployment. GitHub serializes each environment's deploys; do not deploy manually while Actions is active. The App grants source access only and never triggers a push deployment.

Before any Compose startup, the pinned verifier image checks Dokploy's actual cloned HEAD, committed Compose hash, generated Compose configuration and env-file digests. A newer staging/main head is rejected even if the deployment was queued earlier; run the candidate/release for the current approved branch revision instead. The generated file may add only the inspected isolated ingress network and Dokploy/web Traefik metadata; image, command, migration, port, volume and private-network changes are refused.

Migrations then run once through the Compose migrate service, never in each API replica. Only committed `prisma migrate deploy` runs. PostgreSQL health, migration completion, API health and web health are distinct gates. Queue acceptance alone is insufficient. Dokploy replaces GitHub deployment titles with commit messages, so the adapter identifies the new deployment ID rather than relying on its title, rejects competing deployments, and requires its unique verification proof before HTTPS smoke acceptance. Logs containing any secrets are never copied into Actions output. Inspect actual running image digests during the initial manually supervised setup before enabling automation.

The public smoke script checks page, proxied health, anonymous Better Auth session and unauthorized protected access. It does not create users on public deployments. Run browser authentication and secure-cookie checks with dedicated provisioned staging accounts before marking initial staging acceptance complete. The automated container suite covers the full auth lifecycle on disposable data. Public browser/TLS verification is separately recorded in CURRENT-STATE.md.

## Release and production

1. Confirm reviewed staging acceptance, migration compatibility and intended functionality. Add the changelog version section before the candidate is staged.
2. Merge a reviewed staging-to-main promotion and confirm its tree matches the accepted candidate.
3. Run Release from main with version and candidate run ID; the other developer approves the release Environment. It verifies source and registry digests, signs the manifest using GitHub's OIDC attestation service, and publishes the manifest and Sigstore bundle as release assets without rebuilding images. Retain both assets and the original CI run. Signing/publishing failure must stop promotion; retry only after inspecting an existing tag and never move it to another source.
4. Preserve the prior known-good manifest and verify an off-server backup and restore readiness. Record a non-secret backup ID and ISO verification timestamp.
5. Dispatch Deploy production from main with release tag, explicit authorization checkbox, backup reference and timestamp. The other developer approves the production Environment after inspecting version, migrations and backup evidence. No production action occurs automatically on setup or push.
6. Confirm resource identity, migrations, running image digests, HTTPS smoke and browser auth. Archive deployment-record.json with the release, update CURRENT-STATE.md, and retain previous images.

## Failure and recovery

Stop further promotions on any failure. GitHub marks the job failed; deployment-record.json records failed state, timestamp and any captured prior image references. A pending record is not success. Preserve Actions logs and the corresponding Dokploy deployment logs. The adapter intentionally does not emit raw API responses containing environment secrets. There is no automatic application/database rollback while the live infrastructure remains unverified.

For application rollback, inspect schema compatibility first and use the prior known-good release manifest, not merely the resource's most recently configured image values (a failed attempt can leave newer references configured). The GitHub source guard intentionally refuses an older revision after main has advanced. Prepare a reviewed recovery candidate/current-main configuration or an explicitly approved pinned-source recovery procedure; never force-push main or silently relax the guard. Restore only compatible known-good digests under the same approval policy. Never roll migrations backward automatically. If the previous application cannot read the new schema, maintain service isolation and create a reviewed forward fix or approved restore/cutover plan. Do not delete volumes. A failed migration may require DBA review and a deliberately documented `prisma migrate resolve`; never mark it resolved merely to clear CI.

Rollback rehearsal must use a disposable clone with two actually compatible versions. Current tests cover restarts and a restore, not a two-release application rollback; that remains blocked until there are two accepted release artifacts.

## Logs, monitoring and incidents

Use the resource's Deployments and Logs tabs; correlate source SHA, image digests and GitHub run. Health checks cover process/API reachability; API startup verifies a real database query. The current liveness endpoint is not a continuing database readiness probe. Alert on HTTPS availability, unhealthy containers, database disk usage, failed backup age, migration/deployment failure and authentication error spikes. GitHub failed-run notifications and Dokploy notifications should go to both developers; no paid service is required. External uptime alert delivery needs actual configured infrastructure and remains unverified.

Rotate a leaked secret through the protected store, revoke the old token, redeploy deliberately, and document session invalidation for Better Auth secret rotation. Do not log cookies, database URLs or keys. During an incident assign one operator and one reviewer; freeze unrelated changes and preserve evidence.
