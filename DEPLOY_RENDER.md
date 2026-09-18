# Despliegue de DMS Boletas en Render

DMS Boletas funciona como monorepo:

- React/Vite se compila en `dist`.
- Express vive en `backend`.
- El backend sirve el frontend y expone `POST /api/action`.
- **PostgreSQL es la base de datos operacional.**
- Google Drive conserva evidencias, firmas, archivos y documentos.
- Google Sheets se usa únicamente para spreadsheets/reportes generados para el usuario.

## 1. PostgreSQL

Use el recurso PostgreSQL de Render ya creado:

- servicio lógico: `dms-boletas-postgres`
- base: `dms_boletas`
- usuario: `dms_boletas_app`
- región: Oregon, igual que el Web Service

En el Web Service configure **la Internal Database URL** en:

```text
DATABASE_URL=<RENDER INTERNAL DATABASE URL>
```

No coloque URLs de PostgreSQL en GitHub, archivos del repositorio, screenshots ni documentación pública.

## 2. Variables PostgreSQL del Web Service

Valores iniciales validados:

```text
PG_POOL_MAX=3
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=8000
PG_STATEMENT_TIMEOUT_MS=60000
PG_SLOW_QUERY_MS=1000
INCREMENTAL_SYNC_ENABLED=true
SYNC_SCHEMA_VERSION=2
```

No aumente el pool o la concurrencia sin medición.

## 3. Google Cloud

La cuenta de servicio sigue siendo necesaria para Drive, Docs y reportes/spreadsheets generados.

Mantenga en Render:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

`GOOGLE_SHEET_ID` ya no es necesario para persistencia operacional y no debe volver a introducirse como almacenamiento auxiliar.

## 4. Build y start

Render usa:

```text
buildCommand: npm ci && npm run build && npm ci --prefix backend
startCommand: npm --prefix backend start
healthCheckPath: /api/health
```

El backend valida PostgreSQL/migraciones antes de iniciar el servicio HTTP y schedulers.

## 5. Snapshot autoritativo cargado

El cutover de datos se realizó con:

- archivo: `DMS_WebApp_DB (1)(6).xlsx`
- SHA-256: `43ed235976eb09618369dd74555f34922dd85f8149f42f0e1ed1bc74e238395a`
- hojas: 66
- RAW: 31,366
- canonical: 15,979
- canonical válidas: 15,977
- legacy/raw-only: 15,387
- migration run: `209c99d3-6852-4f9e-8ebf-04a144a159ea`

La verificación final confirmó:

- `duplicateFreeOperationalTables=true`
- `exactNewSnapshotOnly=true`
- `sync_state.schema_version=2`
- `sync_state.unsafe=false`
- reimportar el mismo SHA es un no-op

Las 20 duplicidades históricas conocidas pertenecen únicamente a tablas declaradas duplicate-tolerant y se preservan porque existen en la fuente; el cutover no introdujo duplicados nuevos.

## 6. Deploy productivo

Antes de desplegar:

1. confirme que `DATABASE_URL` contiene la **Internal Database URL**;
2. confirme las variables PostgreSQL anteriores;
3. despliegue el commit aprobado de la rama/PR de migración;
4. espere `/api/health` saludable;
5. haga smoke tests de login, Home, pendientes/finalizadas, detalle/evidencias, mantenimientos, clientes, Agenda, Knowledge, Cases, firma, PDF/correos/Drive y sync/offline;
6. confirme que no existe I/O operacional hacia Google Sheets.

## 7. Rollback

Existe un backup PostgreSQL cifrado previo al reemplazo, generado y verificado durante el cutover.

Si ocurre un fallo **antes** de nuevas escrituras PostgreSQL productivas, puede volver al deployment anterior conservando la base para diagnóstico.

Si ya existen nuevas escrituras PostgreSQL, no vuelva ciegamente a Sheets: detenga escrituras, cree un backup, identifique cambios mediante PostgreSQL/SyncChanges y reconcilie antes de cualquier rollback.

## 8. Desarrollo local

Use una PostgreSQL local o de desarrollo:

```bash
export DATABASE_URL='postgresql://...'
npm install
npm --prefix backend install
npm --prefix backend run db:migrate
npm run dev
```

Para pruebas destructivas use exclusivamente `TEST_DATABASE_URL`; los tests rechazan `DATABASE_URL` como sustituto.
