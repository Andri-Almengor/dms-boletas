-- Stage 5 indexes derived from the direct PostgreSQL auth/permission queries.
-- Historical IDs already receive indexes from 002_operational_tables.sql; do
-- not duplicate those indexes here.

CREATE INDEX IF NOT EXISTS "ix_usuarios_login_nombreusuario_norm"
  ON "Usuarios" ((LOWER(BTRIM(COALESCE("NombreUsuario", '')))))
  WHERE "__valid" = TRUE;

CREATE INDEX IF NOT EXISTS "ix_usuarios_login_correo_norm"
  ON "Usuarios" ((LOWER(BTRIM(COALESCE("Correo", '')))))
  WHERE "__valid" = TRUE;

CREATE INDEX IF NOT EXISTS "ix_rolpermisos_rolid_permisoid"
  ON "RolPermisos" ("RolID", "PermisoID")
  WHERE "__valid" = TRUE;

CREATE INDEX IF NOT EXISTS "ix_usuariopermisos_usuarioid_permisoid"
  ON "UsuarioPermisos" ("UsuarioID", "PermisoID")
  WHERE "__valid" = TRUE;
