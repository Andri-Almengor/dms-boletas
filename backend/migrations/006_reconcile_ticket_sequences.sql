-- Keep runtime ticket sequences at or above the imported/historical maximum.
-- This migration is append-only because 004 is already recorded on Render.
-- A stale runtime_sequences row must never cause a duplicate or backwards number.
CREATE OR REPLACE FUNCTION dms_next_ticket_number(p_kind TEXT DEFAULT 'STANDARD')
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_kind TEXT := UPPER(COALESCE(NULLIF(TRIM(p_kind), ''), 'STANDARD'));
  is_maintenance BOOLEAN;
  sequence_entity TEXT;
  seed_value BIGINT;
  issued_value BIGINT;
  formatted_value TEXT;
  seq_db_id BIGINT;
  seq_payload JSONB;
BEGIN
  is_maintenance := normalized_kind IN ('MAINTENANCE', 'MANTENIMIENTO', 'M');

  IF is_maintenance THEN
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

  -- The UPSERT serializes concurrent allocators on the sequence row and repairs
  -- any stale value by moving it forward to at least the historical maximum.
  INSERT INTO runtime_sequences(entity, next_value, updated_at)
  VALUES (sequence_entity, GREATEST(seed_value, 1), NOW())
  ON CONFLICT (entity) DO UPDATE
     SET next_value = GREATEST(runtime_sequences.next_value, EXCLUDED.next_value),
         updated_at = NOW();

  SELECT next_value
    INTO issued_value
    FROM runtime_sequences
   WHERE entity = sequence_entity
   FOR UPDATE;

  UPDATE runtime_sequences
     SET next_value = issued_value + 1,
         updated_at = NOW()
   WHERE entity = sequence_entity;

  IF is_maintenance THEN
    RETURN 'M' || LPAD(issued_value::TEXT, 2, '0');
  END IF;

  formatted_value := issued_value::TEXT;

  -- Preserve the historical Consecutivos projection used by administrative
  -- views while runtime_sequences remains the authoritative allocator.
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
