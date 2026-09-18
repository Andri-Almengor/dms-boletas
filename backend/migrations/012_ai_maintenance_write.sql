-- Controlled AI maintenance write operations.
-- Keeps PREPARE/COMMIT state in PostgreSQL so confirmations survive restarts
-- without storing session tokens, file bytes, signed URLs or Gemini secrets.

CREATE TABLE IF NOT EXISTS "AiPendingOperations" (
  "OperationID" text PRIMARY KEY,
  "UsuarioID" text NOT NULL,
  "SessionFingerprint" text NOT NULL,
  "Type" text NOT NULL,
  "PayloadJSON" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ResultJSON" jsonb,
  "Status" text NOT NULL DEFAULT 'PREPARED',
  "ExpiresAt" timestamptz NOT NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT NOW(),
  "UpdatedAt" timestamptz NOT NULL DEFAULT NOW(),
  "CommittedAt" timestamptz,
  CONSTRAINT "AiPendingOperations_Status_check"
    CHECK ("Status" IN ('PREPARED','COMMITTING','COMPLETED','FAILED','CANCELLED','EXPIRED'))
);

CREATE INDEX IF NOT EXISTS "idx_ai_pending_owner_status"
  ON "AiPendingOperations" ("UsuarioID", "SessionFingerprint", "Status", "ExpiresAt");

CREATE INDEX IF NOT EXISTS "idx_ai_pending_expiry"
  ON "AiPendingOperations" ("ExpiresAt")
  WHERE "Status" IN ('PREPARED','FAILED');

CREATE TABLE IF NOT EXISTS "AiUploadFiles" (
  "UploadBatchID" text NOT NULL,
  "LocalID" text NOT NULL,
  "UsuarioID" text NOT NULL,
  "SessionFingerprint" text NOT NULL,
  "FileName" text NOT NULL,
  "MimeType" text NOT NULL,
  "SizeBytes" bigint NOT NULL,
  "DriveFileID" text NOT NULL,
  "Status" text NOT NULL DEFAULT 'STAGED',
  "ResultJSON" jsonb,
  "ExpiresAt" timestamptz NOT NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT NOW(),
  "UpdatedAt" timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("UploadBatchID", "LocalID"),
  CONSTRAINT "AiUploadFiles_Status_check"
    CHECK ("Status" IN ('STAGED','COMMITTED','CANCELLED','EXPIRED'))
);

CREATE INDEX IF NOT EXISTS "idx_ai_upload_owner_batch"
  ON "AiUploadFiles" ("UsuarioID", "SessionFingerprint", "UploadBatchID", "Status");

CREATE INDEX IF NOT EXISTS "idx_ai_upload_expiry"
  ON "AiUploadFiles" ("ExpiresAt")
  WHERE "Status" = 'STAGED';

-- Resolution/duplicate checks are always scoped by maintenance.
CREATE INDEX IF NOT EXISTS "idx_ai_maintenance_device_name"
  ON "Evidencia_Mantenimientos" (
    "MantenimientoRef",
    lower(regexp_replace(btrim(COALESCE("NombreDispositivo",'')), '\\s+', ' ', 'g'))
  )
  WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false';

CREATE INDEX IF NOT EXISTS "idx_ai_maintenance_device_type"
  ON "Evidencia_Mantenimientos" ("MantenimientoRef", "TipoDispositivoID")
  WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false';

CREATE INDEX IF NOT EXISTS "idx_ai_maintenance_client_date"
  ON "Mantenimiento" ("ClienteID", "Fecha" DESC)
  WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false';
