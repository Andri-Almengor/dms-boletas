-- Foundation for configurable project-style maintenances.
-- Existing records keep the historical MANTENIMIENTO behavior.
ALTER TABLE "Mantenimiento"
  ADD COLUMN IF NOT EXISTS "TipoMantenimiento" TEXT;

UPDATE "Mantenimiento"
SET "TipoMantenimiento" = 'MANTENIMIENTO'
WHERE COALESCE(BTRIM("TipoMantenimiento"), '') = '';

ALTER TABLE "TipoDispositivoPreguntas"
  ADD COLUMN IF NOT EXISTS "AplicaModo" TEXT,
  ADD COLUMN IF NOT EXISTS "TipoDispositivoRelacionadoID" TEXT,
  ADD COLUMN IF NOT EXISTS "ConfiguracionJSON" TEXT;

UPDATE "TipoDispositivoPreguntas"
SET
  "AplicaModo" = CASE
    WHEN COALESCE(BTRIM("AplicaModo"), '') = '' THEN 'MANTENIMIENTO'
    ELSE UPPER(BTRIM("AplicaModo"))
  END,
  "ConfiguracionJSON" = CASE
    WHEN COALESCE(BTRIM("ConfiguracionJSON"), '') = '' THEN '{}'
    ELSE "ConfiguracionJSON"
  END;

CREATE INDEX IF NOT EXISTS ix_dms_maintenance_type
  ON "Mantenimiento" ("TipoMantenimiento")
  WHERE "__valid" = TRUE AND LOWER(COALESCE("Activo", 'true')) <> 'false';

CREATE INDEX IF NOT EXISTS ix_dms_maintenance_questions_mode
  ON "TipoDispositivoPreguntas" ("TipoDispositivoID", "AplicaModo")
  WHERE "__valid" = TRUE AND LOWER(COALESCE("Activo", 'true')) <> 'false';
