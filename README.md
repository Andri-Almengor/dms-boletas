# DMS Boletas

Aplicación React + Vite con backend Node.js. La persistencia operativa es PostgreSQL; Google Drive/Docs/Slides y Google Sheets generado como documento/reporte continúan usando la cuenta de servicio de Google.

## Arquitectura

```text
React / IndexedDB
        |
        v
Backend Node.js / Express
        |
        +--> PostgreSQL (datos operativos, auth, auditoría, SyncChanges)
        |
        +--> Google Drive / Docs / Slides (archivos y documentos)
        +--> Google Sheets (solo spreadsheets generados para reportes)
```

El frontend nunca se conecta directamente a PostgreSQL. `GOOGLE_SHEET_ID` ya no es una dependencia de persistencia.

## Variables principales

```text
DATABASE_URL
TEST_DATABASE_URL              # solo pruebas/integración
PG_POOL_MAX                    # recomendado inicial: 6
PG_IDLE_TIMEOUT_MS             # default 30000
PG_CONNECTION_TIMEOUT_MS       # default 8000
PG_STATEMENT_TIMEOUT_MS        # default 60000
PG_SLOW_QUERY_MS               # default 1000
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
```

Las credenciales de Google se conservan porque Drive, Docs, Slides y algunos spreadsheets de reporte siguen activos.

## Desarrollo

```bash
npm install
npm install --prefix backend
npm run dev
```

Use una base PostgreSQL de desarrollo, nunca producción:

```bash
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:<PORT>/<DB>" npm --prefix backend run db:migrate
```

## Migraciones

Las migraciones versionadas viven en `backend/migrations/` y se registran en `schema_migrations`.

```bash
DATABASE_URL="<DATABASE_URL>" npm --prefix backend run db:migrate
DATABASE_URL="<DATABASE_URL>" npm --prefix backend run db:status
```

## Importar el XLSX de Google Sheets

El XLSX no se versiona en Git. El importador conserva primero todas las filas en `migration_sheet_rows` y luego materializa las 52 tablas operativas. Las 14 hojas legacy quedan preservadas en raw sin reactivar su lógica.

```bash
DATABASE_URL="<DATABASE_URL>" npm --prefix backend run db:import:xlsx -- --file "./DMS_WebApp_DB.xlsx" --dry-run
DATABASE_URL="<DATABASE_URL>" npm --prefix backend run db:import:xlsx -- --file "./DMS_WebApp_DB.xlsx" --apply
DATABASE_URL="<DATABASE_URL>" npm --prefix backend run db:verify -- --file "./DMS_WebApp_DB.xlsx"
```

Para un cutover repetido sobre una base que ya contiene datos use `--replace` únicamente durante una ventana controlada, después de detener escrituras.

## Sync incremental

`SyncChanges` usa un cursor `BIGINT IDENTITY` de PostgreSQL y `sync_state` mantiene generation/schema. La migración eleva el schema de sync a v2 y rota la generación para que IndexedDB haga una sola reconciliación segura; no se reutiliza el cursor global heredado de Sheets.

## Backups

El backup semanal existente ahora genera un snapshot lógico NDJSON comprimido de PostgreSQL y lo sube en streaming a Google Drive. No carga la base completa en RAM.

```bash
npm --prefix backend run db:backup:verify -- --file "<backup.ndjson.gz>"
DATABASE_URL="<EMPTY_OR_RESTORE_DB_URL>" npm --prefix backend run db:backup:restore -- --file "<backup.ndjson.gz>" --apply
```

`--replace` en restore es destructivo y solo debe usarse en una restauración controlada.

## Validación

```bash
npm run test:characterization
npm run build
npm run check:backend
npm run audit:security
```

CI levanta PostgreSQL separado para las pruebas de migraciones/repositorio. La base de producción nunca debe utilizarse en tests.

## Cutover y rollback

El procedimiento completo para Render está en `docs/postgres-render-cutover.md`. Durante el primer cutover no se elimina ni modifica el Google Sheet original: queda como snapshot de emergencia y el rollback consiste en volver al commit/deploy anterior mientras se investiga la migración. No se implementa dual-write permanente.
