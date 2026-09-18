-- Runtime columns that the Sheets implementation used to append dynamically.
-- PostgreSQL schema is migration-owned: these fields must exist before runtime.
ALTER TABLE "Mantenimiento"
  ADD COLUMN IF NOT EXISTS "CarpetaDriveID" TEXT,
  ADD COLUMN IF NOT EXISTS "CarpetaDriveURL" TEXT,
  ADD COLUMN IF NOT EXISTS "EstadoNotificacion" TEXT,
  ADD COLUMN IF NOT EXISTS "ChatDestino" TEXT,
  ADD COLUMN IF NOT EXISTS "ChatEnviadoEn" TEXT,
  ADD COLUMN IF NOT EXISTS "ChatFallbackPruebas" TEXT,
  ADD COLUMN IF NOT EXISTS "ImagenesEsperadas" TEXT,
  ADD COLUMN IF NOT EXISTS "ImagenesCopiadas" TEXT,
  ADD COLUMN IF NOT EXISTS "ImagenesYaExistentes" TEXT,
  ADD COLUMN IF NOT EXISTS "ErroresCopia" TEXT;
