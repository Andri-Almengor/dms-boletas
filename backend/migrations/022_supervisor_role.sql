-- Supervisor comparte el mismo mecanismo de permisos del Administrador.
-- Solo se diferencia al formar listas de personas asignables a visitas.
-- No modifica usuarios ni asignaciones históricas.
INSERT INTO "Roles" (
  "RolID", "Nombre", "Descripcion", "EsAdministrador", "Estado",
  "FechaCreacion", "CreadoPor", "__payload"
)
SELECT
  'e43c8e48-73c8-4f77-909e-35d2b74d0cc0',
  'Supervisor',
  'Acceso administrativo completo sin asignación a visitas, agendas ni trabajos técnicos.',
  'true', 'ACTIVO', CURRENT_TIMESTAMP::text, 'SYSTEM',
  jsonb_build_object(
    'RolID', 'e43c8e48-73c8-4f77-909e-35d2b74d0cc0',
    'Nombre', 'Supervisor',
    'Descripcion', 'Acceso administrativo completo sin asignación a visitas, agendas ni trabajos técnicos.',
    'EsAdministrador', true,
    'Estado', 'ACTIVO',
    'FechaCreacion', CURRENT_TIMESTAMP::text,
    'CreadoPor', 'SYSTEM'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM "Roles"
  WHERE "__valid"=TRUE AND UPPER(BTRIM(COALESCE("Nombre",'')))='SUPERVISOR'
);
