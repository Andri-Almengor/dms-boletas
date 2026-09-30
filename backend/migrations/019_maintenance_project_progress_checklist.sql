-- Per-project progress checklist definition and per-device answers.
-- The feature is isolated to TipoMantenimiento=PROYECTO and reuses existing maintenance/device writes.
ALTER TABLE "Mantenimiento"
  ADD COLUMN IF NOT EXISTS "ProyectoChecklistJSON" TEXT;

ALTER TABLE "Evidencia_Mantenimientos"
  ADD COLUMN IF NOT EXISTS "ProyectoProgresoJSON" TEXT;

UPDATE "Mantenimiento"
SET "ProyectoChecklistJSON" = '{"version":1,"groups":[]}'
WHERE UPPER(COALESCE(NULLIF(BTRIM("TipoMantenimiento"), ''), 'MANTENIMIENTO')) = 'PROYECTO'
  AND COALESCE(BTRIM("ProyectoChecklistJSON"), '') = '';

UPDATE "Evidencia_Mantenimientos" d
SET "ProyectoProgresoJSON" = '{"version":1,"answers":{}}'
FROM "Mantenimiento" m
WHERE m."MantenimientoID" = d."MantenimientoRef"
  AND UPPER(COALESCE(NULLIF(BTRIM(m."TipoMantenimiento"), ''), 'MANTENIMIENTO')) = 'PROYECTO'
  AND COALESCE(BTRIM(d."ProyectoProgresoJSON"), '') = '';
