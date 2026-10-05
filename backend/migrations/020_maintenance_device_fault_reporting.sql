-- Universal device fault flag for both MANTENIMIENTO and PROYECTO.
-- Historical devices remain unchanged semantically: blank values become No.
ALTER TABLE "Evidencia_Mantenimientos"
  ADD COLUMN IF NOT EXISTS "ReportaAveria" TEXT;

UPDATE "Evidencia_Mantenimientos"
SET "ReportaAveria" = 'No'
WHERE COALESCE(BTRIM("ReportaAveria"), '') = '';

CREATE INDEX IF NOT EXISTS ix_dms_notification_maintenance_device_fault
  ON "Notificaciones" ("Entidad", "EntidadID", "Tipo", "FechaCreacion" DESC)
  WHERE "__valid" = TRUE;
