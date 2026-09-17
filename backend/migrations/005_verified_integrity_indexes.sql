-- Constraints proven safe against the source workbook. Do not add uniqueness
-- to historical idempotency keys with known duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "ux_sesiones_tokenhash_nonblank"
  ON "Sesiones" ("TokenHash")
  WHERE "__valid" = TRUE AND "TokenHash" IS NOT NULL AND "TokenHash" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "ux_firmasolicitudes_token_nonblank"
  ON "FirmaSolicitudes" ("Token")
  WHERE "__valid" = TRUE AND "Token" IS NOT NULL AND "Token" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "ux_firmamantenimientosolicitudes_token_nonblank"
  ON "FirmaMantenimientoSolicitudes" ("Token")
  WHERE "__valid" = TRUE AND "Token" IS NOT NULL AND "Token" <> '';

-- Intentionally non-unique: the workbook contains duplicate historical keys.
CREATE INDEX IF NOT EXISTS "ix_notificaciones_idempotency_lookup"
  ON "Notificaciones" ("ClaveIdempotencia", "__db_id")
  WHERE "__valid" = TRUE AND "ClaveIdempotencia" IS NOT NULL AND "ClaveIdempotencia" <> '';

CREATE INDEX IF NOT EXISTS "ix_integracioncomandos_idempotency_lookup"
  ON "IntegracionComandos" ("IdempotencyKey", "__db_id")
  WHERE "__valid" = TRUE AND "IdempotencyKey" IS NOT NULL AND "IdempotencyKey" <> '';
