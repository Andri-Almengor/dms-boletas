-- Efficient pagination of existing Boletas entries in the shared Auditoria table.
-- The read route only accesses its own ticket and edit/autosave actions.
CREATE INDEX IF NOT EXISTS "idx_auditoria_historial_boletas"
  ON "Auditoria" ("EntidadID", "Fecha" DESC, "__db_id" DESC)
  WHERE "__valid"=TRUE
    AND "Entidad"='Boletas'
    AND "Accion" IN ('EDITAR_BOLETA', 'AUTOGUARDAR_BOLETA');
