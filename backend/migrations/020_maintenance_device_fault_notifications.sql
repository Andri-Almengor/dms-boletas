-- Estado mínimo de idempotencia para avisos de avería por dispositivo.
-- La pregunta vive en RespuestasJSON; esta columna conserva la clave del incidente
-- activo para que múltiples guardados o instancias de Render no dupliquen el correo.
ALTER TABLE "Evidencia_Mantenimientos"
  ADD COLUMN IF NOT EXISTS "AveriaNotificacionClave" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_dms_maintenance_device_fault_key
  ON "Evidencia_Mantenimientos" ("AveriaNotificacionClave")
  WHERE "__valid" = TRUE
    AND COALESCE(BTRIM("AveriaNotificacionClave"), '') <> '';
