-- A single idempotency claim per authenticated visual Docs export, shared by all Render instances.
-- The table stores only report metadata and the Drive file identifier, never device data.
CREATE TABLE IF NOT EXISTS "MantenimientoInformesVisuales" (
  "RequestKey" UUID PRIMARY KEY,
  "UsuarioID" TEXT NOT NULL,
  "Cliente" TEXT NOT NULL,
  "Fecha" TEXT NOT NULL,
  "Filtro" TEXT NOT NULL,
  "Estado" TEXT NOT NULL DEFAULT 'CREATING',
  "DocumentoID" TEXT,
  "CantidadDispositivos" INTEGER,
  "CreadoEn" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ActualizadoEn" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
