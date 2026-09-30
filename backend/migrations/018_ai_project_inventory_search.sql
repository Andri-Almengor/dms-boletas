-- Accelerate read-only AI/project inventory filters without changing business behavior.
-- pg_trgm remains optional exactly like migration 011.
DO $ai_project_search$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_project_answers_trgm ON "Evidencia_Mantenimientos" USING GIN ("RespuestasJSON" gin_trgm_ops) WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",''true'')) <> ''false''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_maintenance_image_note_trgm ON "Mantenimiento imagenes" USING GIN ("Nota" gin_trgm_ops) WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",''true'')) <> ''false''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_project_component_name_trgm ON "Mantenimiento imagenes" USING GIN ("ProyectoComponenteNombre" gin_trgm_ops) WHERE "__valid"=TRUE AND UPPER(COALESCE("ContextoEvidencia",''''))=''PROYECTO'' AND LOWER(COALESCE("Activo",''true'')) <> ''false''';
  END IF;
END
$ai_project_search$;

CREATE INDEX IF NOT EXISTS ix_ai_maintenance_type_date
  ON "Mantenimiento" ("TipoMantenimiento", "Fecha")
  WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false';

CREATE INDEX IF NOT EXISTS ix_ai_project_evidence_component_type
  ON "Mantenimiento imagenes" ("ProyectoComponenteTipoDispositivoID", "FechaCaptura" DESC)
  WHERE "__valid"=TRUE
    AND UPPER(COALESCE("ContextoEvidencia",''))='PROYECTO'
    AND UPPER(COALESCE("ProyectoDestinoTipo",''))='COMPONENTE'
    AND LOWER(COALESCE("Activo",'true')) <> 'false';
