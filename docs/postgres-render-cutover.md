# Render PostgreSQL cutover

This runbook migrates DMS Boletas from its Google Sheets operational database to Render PostgreSQL while keeping Google Drive/Docs and generated report spreadsheets enabled.

## 1. Database resource

Create the PostgreSQL service in the same Render region as the DMS web service.

Recommended initial values for the current workload:

- Name: `dms-boletas-postgres`
- Database: `dms_boletas`
- User: `dms_boletas_app`
- Region: the same region as the web service
- Compute: 0.1 CPU / 256 MB is acceptable for migration and initial validation; increase only if measured load requires it
- Storage: 5 GB
- Storage autoscaling: disabled during migration; enable later only if desired
- High availability: disabled on the initial small plan

Do not store either Render database URL in GitHub, source files, screenshots, issues, PR text, or logs.

## 2. Which URL to use

Use the **External Database URL** only from an administrator workstation or other system outside Render. Use the **Internal Database URL** in the Render web service after cutover. Both point to the same database.

Set the URL only in the current shell environment:

```bash
export DATABASE_URL='<RENDER_EXTERNAL_DATABASE_URL>'
```

## 3. Install and migrate

From the repository root:

```bash
npm install --prefix backend
npm --prefix backend run db:migrate
npm --prefix backend run db:status
```

`db:migrate` is idempotent. Never edit an already-applied migration; add a new numbered migration instead.

## 4. Dry-run the XLSX

Keep the workbook outside Git. Then run:

```bash
npm --prefix backend run db:import:xlsx -- \
  --file './DMS_WebApp_DB (1)(6).xlsx' \
  --dry-run
```

Confirm the workbook SHA-256 and reconciliation counts before applying.

## 5. Apply the source workbook

For the first import into an empty database:

```bash
npm --prefix backend run db:import:xlsx -- \
  --file './DMS_WebApp_DB (1)(6).xlsx' \
  --apply
```

If a controlled rehearsal must be repeated against a disposable database, use `--replace`. Do not use `--replace` after the application begins writing production data.

## 6. Verify the migration

```bash
npm --prefix backend run db:verify -- \
  --file './DMS_WebApp_DB (1)(6).xlsx'

npm --prefix backend run db:benchmark
```

Verification must show that every workbook data row exists in raw migration storage. Legacy rows are preserved raw but are not reactivated as runtime tables. The two malformed maintenance-signature rows remain preserved and canonical-invalid by design. The final applied source SHA is `43ed235976eb09618369dd74555f34922dd85f8149f42f0e1ed1bc74e238395a`.

## 7. Integration tests

Never point destructive integration tests at production. Use a disposable database URL:

```bash
export TEST_DATABASE_URL='<DISPOSABLE_TEST_DATABASE_URL>'
NODE_ENV=test npm --prefix backend run db:migrate
NODE_ENV=test npm --prefix backend run test:db
```

The integration test intentionally refuses to use `DATABASE_URL` as a substitute for `TEST_DATABASE_URL`.

## 8. Configure the Render web service

Before deployment, add these environment variables to the existing DMS web service:

```text
DATABASE_URL=<RENDER_INTERNAL_DATABASE_URL>
PG_POOL_MAX=3
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=8000
PG_STATEMENT_TIMEOUT_MS=60000
PG_SLOW_QUERY_MS=1000
SYNC_SCHEMA_VERSION=2
INCREMENTAL_SYNC_ENABLED=true
```

For the 256 MB database plan, start conservatively with `PG_POOL_MAX=3`. The application does not need one connection per HTTP request and should not use an oversized pool on the initial plan.

Keep the existing Google service-account and Drive/report variables. `GOOGLE_SHEET_ID` is no longer used by operational persistence and may be removed after rollback confidence is established.

## 9. Controlled cutover

1. Keep the current Google Sheet unchanged as the rollback snapshot.
2. Stop user writes or schedule a short maintenance window.
3. Export the final authoritative workbook.
4. Run `db:migrate`.
5. Run XLSX `--dry-run` and review counts/anomalies.
6. Run XLSX `--apply` (or the controlled final `--replace` only before any PostgreSQL production writes exist).
7. Run `db:verify` and `db:benchmark`.
8. Configure the web service `DATABASE_URL` with the **Internal Database URL**.
9. Deploy the migration branch/approved commit.
10. Confirm `/api/health` reports PostgreSQL ready.
11. Test login, Home, pending/finalized tickets, ticket detail, evidence upload/download, signatures, maintenance, clients, Agenda, Knowledge, Cases, offline reconciliation and SyncChanges.
12. Keep the Sheet snapshot read-only during the observation period. Do not dual-write.

## 10. Rollback

If a blocking regression occurs before new authoritative PostgreSQL-only writes must be retained:

1. stop new writes;
2. redeploy the previous known-good application commit;
3. restore its former environment configuration if required;
4. keep the PostgreSQL database untouched for diagnosis;
5. do not delete the raw migration tables or source workbook.

Once production writes have occurred only in PostgreSQL, rollback requires reconciling those writes before switching storage back. Do not silently discard them.

## 11. Backup

The weekly job now creates a compressed portable PostgreSQL snapshot and streams it to the configured Google Drive backup folder. A backup is not considered valid until `db:backup:verify` can read it. Restore drills should use an empty disposable PostgreSQL database.
