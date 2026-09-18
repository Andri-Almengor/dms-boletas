-- Atomic runtime ticket numbers. Imported/historical rows are inserted directly
-- by the migration importer and are never renumbered by this mechanism.
CREATE TABLE IF NOT EXISTS runtime_sequences (
  entity TEXT PRIMARY KEY,
  next_value BIGINT NOT NULL CHECK (next_value > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_boletas_allocate_number ON "Boletas";
DROP FUNCTION IF EXISTS dms_allocate_ticket_number();

CREATE OR REPLACE FUNCTION dms_next_ticket_number(p_kind TEXT DEFAULT 'STANDARD')
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_kind TEXT := UPPER(COALESCE(NULLIF(TRIM(p_kind), ''), 'STANDARD'));
  sequence_entity TEXT;
  seed_value BIGINT;
  issued_value BIGINT;
  formatted_value TEXT;
  seq_db_id BIGINT;
  seq_payload JSONB;
BEGIN
  IF normalized_kind = 'MAINTENANCE' THEN
    sequence_entity := 'MANTENIMIENTO_BOLETA';
    SELECT COALESCE(MAX(SUBSTRING("BoletaID" FROM 2)::BIGINT), 0) + 1
      INTO seed_value
      FROM "Boletas"
     WHERE "__valid" = TRUE
       AND COALESCE("BoletaID", '') ~ '^M[0-9]+$';
  ELSE
    sequence_entity := 'BOLETA';
    SELECT COALESCE(MAX("BoletaID"::BIGINT), 0) + 1
      INTO seed_value
      FROM "Boletas"
     WHERE "__valid" = TRUE
       AND COALESCE("BoletaID", '') ~ '^[0-9]+$';
  END IF;

  INSERT INTO runtime_sequences(entity, next_value)
  VALUES (sequence_entity, GREATEST(seed_value, 1))
  ON CONFLICT (entity) DO NOTHING;

  SELECT next_value
    INTO issued_value
    FROM runtime_sequences
   WHERE entity = sequence_entity
   FOR UPDATE;

  UPDATE runtime_sequences
     SET next_value = issued_value + 1,
         updated_at = NOW()
   WHERE entity = sequence_entity;

  IF normalized_kind = 'MAINTENANCE' THEN
    formatted_value := 'M' || LPAD(issued_value::TEXT, 2, '0');
    RETURN formatted_value;
  END IF;

  formatted_value := issued_value::TEXT;

  -- Keep the historical Consecutivos row coherent for existing administrative
  -- views/configuration, but never use its stale value as the source of truth.
  SELECT "__db_id", "__payload"
    INTO seq_db_id, seq_payload
    FROM "Consecutivos"
   WHERE "__valid" = TRUE
     AND UPPER(COALESCE("Entidad", '')) = 'BOLETA'
   ORDER BY "__db_id" DESC
   LIMIT 1
   FOR UPDATE;

  IF seq_db_id IS NOT NULL THEN
    UPDATE "Consecutivos"
       SET "SiguienteNumero" = (issued_value + 1)::TEXT,
           "UltimoNumeroUsado" = issued_value::TEXT,
           "FechaActualizacion" = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           "__payload" = jsonb_set(
             jsonb_set(
               jsonb_set(
                 COALESCE(seq_payload, '{}'::jsonb),
                 '{SiguienteNumero}', to_jsonb((issued_value + 1)::TEXT), TRUE
               ),
               '{UltimoNumeroUsado}', to_jsonb(issued_value::TEXT), TRUE
             ),
             '{FechaActualizacion}',
             to_jsonb(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
             TRUE
           )
     WHERE "__db_id" = seq_db_id;
  END IF;

  RETURN formatted_value;
END;
$$;
