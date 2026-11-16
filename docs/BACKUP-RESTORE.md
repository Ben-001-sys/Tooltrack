# PostgreSQL backup and restoration

Persistent volumes preserve data across container restarts; they are not backups. Use PostgreSQL 17 client tooling. Store encrypted backups off the Dokploy server with separate credentials, access controls, retention and recovery keys. A suggested starting policy is daily backups retained 14 days and weekly copies retained 8 weeks, adjusted by the owners to accepted recovery point/time objectives. Test restoration regularly and before a consequential schema migration. No live backup schedule/storage has been configured.

## Backup

Identify the exact Project, Environment, Compose resource and postgres container. Never select a container solely by a similar global name. In a controlled server shell, use `docker compose` with that resource's verified project and compose file to execute `pg_dump -Fc --no-owner` as the configured database user. Stream the binary output to a protected file using a binary-safe shell or process API (PowerShell text redirection can corrupt archives). Check nonzero exits, hash the archive, encrypt and transfer it off-server, then verify remote size/hash. Credentials come from the resource's secure environment or a temporary protected pgpass file, never chat or command logs.

Document backup ID, database/environment, timestamp, migration state, source release and image digests, archive checksum, storage location, encryption key recovery and who verified it. Capture roles/extensions separately when needed. A logical dump alone does not provide point-in-time recovery; design WAL archival only when recovery objectives justify it.

## Disposable restore test

`node deploy/scripts/verify-containers.mjs` creates a random disposable Compose project, applies both migrations, creates a test auth user, dumps with pg_dump, restores via binary stdin into a separate `restore_verification` database, checks user counts, and tests persistence through restarts. It cleans up only that random test project. This tests format compatibility and a sample record, not live backup permissions, off-server transfer or a production recovery-time objective.

## Real recovery

Obtain explicit authorization for a new isolated recovery database/server and the intended cutover. Keep the existing database intact. Restore using `pg_restore --exit-on-error --no-owner` into a new empty database. Check schema, migration history, constraints, representative row counts and application auth using an isolated configuration. Compare archive checksum and data freshness to recovery objectives. Reconcile writes made since the backup using a reviewed synchronization/cutover plan; do not copy staging data into production. Stop writes only under the approved maintenance plan, switch the API's DATABASE_URL through the protected environment, and validate health/auth before reopening traffic. Retain the old database until the recovery is accepted and retention policy permits disposal.

Use expand-and-contract migrations: add compatible fields/tables, deploy compatible readers/writers, backfill with monitored idempotent jobs, verify, then remove old schema in a later reviewed release. Never run migrate reset or migrate dev in staging/production. Never reverse database migrations as an automatic rollback.
