-- Project evidence metadata layered on top of the existing maintenance evidence table.
-- Historical maintenance evidence keeps its Antes/Despues semantics.
ALTER TABLE "Mantenimiento imagenes"
  ADD COLUMN IF NOT EXISTS "ContextoEvidencia" TEXT,
  ADD COLUMN IF NOT EXISTS "FechaCaptura" TEXT,
  ADD COLUMN IF NOT EXISTS "ProyectoDestinoTipo" TEXT,
  ADD COLUMN IF NOT EXISTS "ProyectoRelacionClave" TEXT,
  ADD COLUMN IF NOT EXISTS "ProyectoComponenteLocalID" TEXT,
  ADD COLUMN IF NOT EXISTS "ProyectoComponenteTipoDispositivoID" TEXT,
  ADD COLUMN IF NOT EXISTS "ProyectoComponenteNombre" TEXT;

UPDATE "Mantenimiento imagenes"
SET
  "ContextoEvidencia" = CASE
    WHEN COALESCE(BTRIM("ContextoEvidencia"), '') = '' THEN 'MANTENIMIENTO'
    ELSE UPPER(BTRIM("ContextoEvidencia"))
  END,
  "FechaCaptura" = COALESCE(NULLIF(BTRIM("FechaCaptura"), ''), NULLIF(BTRIM("FechaCreacion"), ''))
WHERE
  COALESCE(BTRIM("ContextoEvidencia"), '') = ''
  OR COALESCE(BTRIM("FechaCaptura"), '') = '';

CREATE INDEX IF NOT EXISTS ix_dms_maintenance_images_capture
  ON "Mantenimiento imagenes" ("DispositivoMantenimientoRef", "FechaCaptura" DESC)
  WHERE "__valid" = TRUE AND LOWER(COALESCE("Activo", 'true')) <> 'false';

CREATE INDEX IF NOT EXISTS ix_dms_project_evidence_component
  ON "Mantenimiento imagenes" ("ProyectoComponenteLocalID", "FechaCaptura" DESC)
  WHERE "__valid" = TRUE
    AND UPPER(COALESCE("ContextoEvidencia", '')) = 'PROYECTO'
    AND LOWER(COALESCE("Activo", 'true')) <> 'false';
