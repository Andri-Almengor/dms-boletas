-- Clasificación de gravedad por dispositivo con falla en mantenimientos.
-- No modificamos el estado, observaciones ni registros históricos existentes.
ALTER TABLE "Evidencia_Mantenimientos"
  ADD COLUMN IF NOT EXISTS "GravedadFalla" TEXT;
