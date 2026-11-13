-- Enlaces manuales entre evidencias históricas de un MISMO cliente.
-- Sobreviven a inventory.generate, que reemplaza exclusivamente el snapshot.
-- Sin alterar boletas, mantenimientos ni sus claves operativas.
CREATE TABLE IF NOT EXISTS dms_client_inventory_manual_links (
  client_id TEXT NOT NULL REFERENCES dms_client_inventory(client_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  canonical_source_id TEXT NOT NULL,
  preferred_device_name TEXT NOT NULL DEFAULT '',
  linked_by TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_dms_client_inventory_manual_links_target
  ON dms_client_inventory_manual_links(client_id, canonical_source_id);

-- Idempotencia de solicitudes administrativas, incluso tras vincular otro equipo.
CREATE TABLE IF NOT EXISTS dms_client_inventory_manual_link_requests (
  client_id TEXT NOT NULL REFERENCES dms_client_inventory(client_id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  kept_device_id TEXT NOT NULL,
  merged_device_id TEXT NOT NULL,
  linked_by TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, request_key)
);

-- Reutiliza el catálogo generado en el modal Agregar ubicación y durante
-- importaciones en lote; índice por cliente y ubicación exacta del dispositivo.
CREATE INDEX IF NOT EXISTS ix_dms_client_inventory_devices_equipment_location
  ON dms_client_inventory_devices(client_id, (details->>'equipmentLocationId'));
