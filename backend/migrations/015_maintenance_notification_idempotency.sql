-- Guarantee one maintenance progress Chat delivery per idempotency key.
-- Historical duplicate rows are preserved for audit, but only one canonical row
-- keeps the original key. This allows a partial UNIQUE index to protect all
-- future scheduler instances from racing on the same 07:00/17:00 notification.

WITH ranked AS (
  SELECT
    "__db_id",
    "ClaveIdempotencia",
    ROW_NUMBER() OVER (
      PARTITION BY "ClaveIdempotencia"
      ORDER BY
        CASE WHEN UPPER(COALESCE("Estado", '')) = 'ENVIADO' THEN 0 ELSE 1 END,
        "__db_id" ASC
    ) AS duplicate_rank
  FROM "Notificaciones"
  WHERE "__valid" = TRUE
    AND COALESCE("ClaveIdempotencia", '') <> ''
),
duplicates AS (
  SELECT
    "__db_id",
    "ClaveIdempotencia"
      || '|DUPLICATE|'
      || "__db_id"::text AS replacement_key
  FROM ranked
  WHERE duplicate_rank > 1
)
UPDATE "Notificaciones" AS notification
SET
  "ClaveIdempotencia" = duplicates.replacement_key,
  "__payload" = jsonb_set(
    COALESCE(notification."__payload", '{}'::jsonb),
    '{ClaveIdempotencia}',
    to_jsonb(duplicates.replacement_key),
    TRUE
  )
FROM duplicates
WHERE notification."__db_id" = duplicates."__db_id";

CREATE UNIQUE INDEX IF NOT EXISTS ux_notificaciones_clave_idempotencia
  ON "Notificaciones" ("ClaveIdempotencia")
  WHERE "__valid" = TRUE
    AND "ClaveIdempotencia" IS NOT NULL
    AND "ClaveIdempotencia" <> '';
