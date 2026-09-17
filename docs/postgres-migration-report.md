# PostgreSQL migration report

> Prepared from the workbook supplied with the migration task. This document intentionally contains no password hashes, session hashes, encrypted credential values, tokens, webhooks, or row payloads.

## Source

- File received in the workspace: `DMS_WebApp_DB (1)(2).xlsx`
- SHA-256: `20c811d40231e7c2627fedeb32fcd748056aa77c0ebf5db037e360951e694512`
- Sheets detected: **66**
- Data rows detected: **31,347**
- Formula cells: **0**
- Operational sheets: **52 / 15,960 rows**
- Legacy/historical sheets: **14 / 15,387 rows**
- Raw rows preserved by the importer: **31,347**
- Canonical operational rows: **15,960**
- Canonical rows marked valid: **15,958**

The task text referenced `DMS_WebApp_DB (1)(1).xlsx`; the actual attachment received was `(1)(2)`. The hash above is the authoritative identity used for idempotent imports.

## Workbook anomalies characterized before schema design

| Class | Count | Handling |
| --- | ---: | --- |
| Duplicate effective keys in `Configuracion` | 17 | Preserve every raw/canonical row; reads use first-row semantics, updates use last-match semantics, and `getConfig()` retains last-value-wins behavior while iterating. No unique constraint on `Clave`. |
| Duplicate `ClienteUbicacionesEquipo.UbicacionEquipoID` | 3 | Preserve all rows; internal identity PK is used. No unique constraint on the business ID. |
| Malformed `FirmaMantenimientoSolicitudes` rows | 2 | Preserve raw and canonical rows, mark canonical rows `__valid = false`, never reinterpret them as valid signature requests. |
| Orphan references observed in the workbook | 278 | Preserve unchanged and report. Foreign keys that would reject source data are deferred rather than deleting or fabricating parents. |
| Duplicate `Notificaciones.ClaveIdempotencia` values | 2 values / 2 extra rows | Preserve and index non-uniquely. |
| Duplicate `IntegracionComandos.IdempotencyKey` values | 10 values / 26 extra rows | Preserve and index non-uniquely. |

No other duplicate business-ID classes were found across the 52 operational sheets in the supplied workbook.

### Orphan-reference groups

The 278 source inconsistencies are distributed as follows; no row is discarded:

- `BoletaAsignados.BoletaUID -> Boletas.BoletaUID`: 109
- `BoletaAsignados.UsuarioID -> Usuarios.UsuarioID`: 75
- `EncuestaRespuestas.EncuestaID -> Encuestas.EncuestaID`: 25
- `Sesiones.UsuarioID -> Usuarios.UsuarioID`: 17
- `EvidenciasBoleta.BoletaUID -> Boletas.BoletaUID`: 16
- `Boletas.UbicacionEquipoID -> ClienteUbicacionesEquipo.UbicacionEquipoID`: 15
- `Boletas.UbicacionID -> ClienteUbicaciones.UbicacionID`: 6
- `Modelos.FabricanteID -> Fabricantes.FabricanteID`: 3
- `FirmaSolicitudes.BoletaUID -> Boletas.BoletaUID`: 3
- `ClienteUbicacionesEquipo.UbicacionID -> ClienteUbicaciones.UbicacionID`: 2
- `Evidencia_Mantenimientos.FabricanteID -> Fabricantes.FabricanteID`: 2
- `Encuestas.ClienteID -> Clientes.ClienteID`: 2
- `Modelos.TipoDispositivoID -> TiposDispositivo.TipoDispositivoID`: 1
- `TipoDispositivoFabricantes.TipoDispositivoID -> TiposDispositivo.TipoDispositivoID`: 1
- `Boletas.FabricanteID -> Fabricantes.FabricanteID`: 1

## Legacy preservation

These sheets are imported into `migration_sheet_rows` and are deliberately not reactivated as application tables:

`ActividadApp`, `ContactosCliente`, `ImportacionHistoricaLog`, `ImportacionHistoricaPreview`, `MigracionRelacionesLog`, `MigracionRelacionesPreview`, `ModelosHistoricosRevision`, `PreguntasDispositivo`, `ReparacionClientesLog`, `ReparacionClientesPreview`, `UbicacionesCliente`, `UbicacionesEquipo`, `_Schema`, `__VALIDACION_DEPURACION_2026072`.

`ActividadApp` contributes 12,325 historical rows. Its former reporting feature is not restored.

## Migration model

- `migration_runs`: one immutable source-workbook identity/run record.
- `migration_sheet_rows`: every non-header workbook row with sheet name, source row number, JSONB source representation, SHA-256 row checksum, and import time.
- `migration_anomalies`: duplicate/malformed/orphan/type/shape findings without sensitive values in logs.
- `migration_reconciliation`: source/raw/canonical counts and per-sheet checksum/status.
- Operational tables: explicit versioned schema; never created from arbitrary runtime columns.
- Historical business IDs remain `TEXT`; technical `__db_id BIGINT IDENTITY` keys are used where source uniqueness cannot be guaranteed.
- Drive file bodies remain in Google Drive. PostgreSQL stores only existing metadata/relationships/IDs/URLs.

## Sync cutover

`SyncChanges.Cursor` from column L in the workbook is treated as legacy global metadata, not as a per-event column. PostgreSQL assigns a real monotonic identity cursor to each imported/new event. Import rotates the sync generation and uses schema version **2**, forcing one safe IndexedDB reconciliation so a Sheets cursor is never interpreted as a PostgreSQL cursor.

## Consecutives

`Consecutivos.Entidad = BOLETA` is treated as the logical sequence row. New ticket-number allocation is protected by PostgreSQL row locking in the same transaction as insertion. Historical `BoletaID` values are never renumbered. Maintenance-generated `Mxx` ticket numbers use a separate PostgreSQL runtime sequence initialized from existing data.

## Verified-safe uniqueness

The workbook supports uniqueness for session token hashes and public-signature tokens, so partial unique indexes are created for nonblank valid rows. Known-duplicated idempotency keys remain non-unique. Most clean business IDs use partial unique indexes; `Configuracion.Clave` and `ClienteUbicacionesEquipo.UbicacionEquipoID` deliberately do not.

## Validation status

Local workspace validation can cover workbook structure/checksums and JavaScript syntax, but this execution environment has no PostgreSQL server/Docker and cannot resolve the npm registry. Real PostgreSQL migration/repository tests are therefore executed in GitHub Actions using an isolated PostgreSQL service container. Final CI results and query-plan/benchmark evidence must be recorded after the PR workflow completes; they must not be inferred from this report.

## Cutover invariant

The importer is designed so `db:verify` can answer whether any workbook row or canonical source payload changed. A canonical count smaller than source count is only acceptable for deliberately non-operational legacy sheets or canonical rows marked invalid while the corresponding source row remains in raw storage. No workbook source row is silently dropped.
