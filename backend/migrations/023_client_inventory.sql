-- Inventario consolidado por cliente, generado explícitamente por un administrador.
-- PostgreSQL es la única fuente de persistencia; no interviene Google Sheets.
CREATE TABLE IF NOT EXISTS dms_client_inventory (
  client_id TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  device_count INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'not_requested'
);

CREATE TABLE IF NOT EXISTS dms_client_inventory_devices (
  client_id TEXT NOT NULL REFERENCES dms_client_inventory(client_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  mac TEXT NOT NULL DEFAULT '',
  source_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(client_id, device_id)
);
CREATE INDEX IF NOT EXISTS ix_dms_client_inventory_devices_lookup
  ON dms_client_inventory_devices(client_id, device_name, device_id);

CREATE TABLE IF NOT EXISTS dms_client_inventory_events (
  client_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('MANTENIMIENTO', 'BOLETA')),
  source_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  technicians TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(client_id, device_id, event_key),
  FOREIGN KEY(client_id, device_id)
    REFERENCES dms_client_inventory_devices(client_id, device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_dms_client_inventory_events_date
  ON dms_client_inventory_events(client_id, device_id, occurred_at DESC, event_key);

CREATE TABLE IF NOT EXISTS dms_client_inventory_media (
  client_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('MANTENIMIENTO', 'BOLETA')),
  source_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(client_id, device_id, media_key),
  FOREIGN KEY(client_id, device_id)
    REFERENCES dms_client_inventory_devices(client_id, device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_dms_client_inventory_media_device
  ON dms_client_inventory_media(client_id, device_id, occurred_at DESC, media_key);
