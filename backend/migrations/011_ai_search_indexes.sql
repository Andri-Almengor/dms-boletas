-- AI assistant search acceleration. PostgreSQL remains the only operational source.
-- pg_trgm is optional: if Render does not expose it, deployment keeps working without these indexes.
DO $ai_search$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN insufficient_privilege OR undefined_file THEN
      RAISE NOTICE 'pg_trgm is unavailable; AI trigram indexes are skipped.';
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_client_name_trgm ON "Clientes" USING GIN ("Nombre" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_maintenance_title_trgm ON "Mantenimiento" USING GIN ("TituloMantenimiento" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_maintenance_client_trgm ON "Mantenimiento" USING GIN ("Cliente" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_ticket_title_trgm ON "Boletas" USING GIN ("Titulo" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_ticket_client_trgm ON "Boletas" USING GIN ("Cliente" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_user_name_trgm ON "Usuarios" USING GIN ("NombreCompleto" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_device_name_trgm ON "Evidencia_Mantenimientos" USING GIN ("NombreDispositivo" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_device_model_trgm ON "Evidencia_Mantenimientos" USING GIN ("Modelo" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_knowledge_title_trgm ON "KnowledgeArticles" USING GIN ("Titulo" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_case_problem_trgm ON "CasosClientes" USING GIN ("Problema" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_integration_ip_trgm ON "IntegracionDispositivos" USING GIN ("DireccionIP" gin_trgm_ops) WHERE "__valid"=TRUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_ai_integration_mac_trgm ON "IntegracionDispositivos" USING GIN ("DireccionMAC" gin_trgm_ops) WHERE "__valid"=TRUE';
  END IF;
END
$ai_search$;

CREATE INDEX IF NOT EXISTS ix_ai_evidence_uploader_date
  ON "EvidenciasBoleta" ("CreadoPor", "FechaCreacion")
  WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false';

CREATE INDEX IF NOT EXISTS ix_ai_maintenance_image_uploader_date
  ON "Mantenimiento imagenes" ("CreadoPor", "FechaCreacion")
  WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false';
