-- Stage 5 indexes for real authorization/media lookup queries.
-- The migration runner wraps each migration in a transaction.

CREATE INDEX IF NOT EXISTS "ix_boletaasignados_boletauid_usuarioid"
  ON "BoletaAsignados" ("BoletaUID", "UsuarioID")
  WHERE "__valid" = TRUE;

CREATE INDEX IF NOT EXISTS "ix_evidenciasboleta_archivoid"
  ON "EvidenciasBoleta" ("ArchivoID")
  WHERE "__valid" = TRUE AND "ArchivoID" <> '';

CREATE INDEX IF NOT EXISTS "ix_boletas_firmaarchivoid"
  ON "Boletas" ("FirmaArchivoID")
  WHERE "__valid" = TRUE AND "FirmaArchivoID" <> '';
