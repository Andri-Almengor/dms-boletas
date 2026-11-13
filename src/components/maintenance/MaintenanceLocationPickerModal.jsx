import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import ProcessingOverlay from '../feedback/ProcessingOverlay';
import MaintenanceEquipmentLocationSelect from './MaintenanceEquipmentLocationSelect';
import useOverlaySurface from '../../hooks/useOverlaySurface';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

export default function MaintenanceLocationPickerModal({
  open,
  maintenanceLocationId,
  clientId,
  sessionToken,
  projectMode = false,
  existingLocations = [],
  onClose,
  onSave,
  saving = false,
}) {
  const [selection, setSelection] = useState(null);
  const [includeInventoryDevices, setIncludeInventoryDevices] = useState(false);
  const [inventoryPreview, setInventoryPreview] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  useOverlaySurface({ open, onClose, busy: saving });
  const existingIds = useMemo(
    () => new Set(existingLocations.map((item) => String(item.id || item.UbicacionEquipoID || '')).filter(Boolean)),
    [existingLocations],
  );

  useEffect(() => {
    setIncludeInventoryDevices(false);
    setInventoryPreview(null);
    if (!open || !selection?.id || !clientId || !sessionToken || projectMode
      || (typeof navigator !== 'undefined' && navigator.onLine === false)) return undefined;
    const controller = new AbortController();
    setInventoryLoading(true);
    requestAvailable(MODULE_ROUTES.inventory.devices, {
      clienteId: clientId, equipmentLocationId: selection.id, page: 1, pageSize: 1,
    }, sessionToken, { signal: controller.signal, cache: 'no-store' })
      .then((result) => {
        if (!controller.signal.aborted) setInventoryPreview({
          generated: result?.generated === true,
          count: Number(result?.totalFiltered || 0),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setInventoryPreview(null);
      })
      .finally(() => { if (!controller.signal.aborted) setInventoryLoading(false); });
    return () => controller.abort();
  }, [open, selection?.id, clientId, sessionToken, projectMode]);

  if (!open) return null;

  const duplicate = selection?.id && existingIds.has(selection.id);

  async function submit(event) {
    event.preventDefault();
    if (!selection?.id || duplicate) return;
    const saved = await onSave?.(selection, { importInventoryDevices: includeInventoryDevices });
    if (saved) { setSelection(null); setIncludeInventoryDevices(false); }
  }

  async function handleCreated(location) {
    setSelection(location);
    const saved = await onSave?.(location, { importInventoryDevices: false });
    if (saved) setSelection(null);
    return saved;
  }

  function close() {
    if (saving) return;
    setSelection(null);
    setIncludeInventoryDevices(false);
    onClose?.();
  }

  return (
    <div className="maintenance-evidence-modal maintenance-location-picker-modal" role="dialog" aria-modal="true" aria-label="Agregar ubicación al mantenimiento">
      <button className="maintenance-evidence-modal__backdrop" type="button" onClick={close} aria-label="Cerrar" />
      <section className="maintenance-evidence-modal__panel maintenance-location-picker-modal__panel">
        <header className="maintenance-location-picker-modal__header">
          <span><Icon name="add_location_alt" /></span>
          <div><span className="eyebrow">UBICACIÓN DEL EQUIPO</span><h2>Agregar ubicación al mantenimiento</h2><p>Después podrá agregar dispositivos directamente dentro de esta ubicación.</p></div>
          <button className="icon-button" type="button" onClick={close} disabled={saving} aria-label="Cerrar"><Icon name="close" /></button>
        </header>

        <form className="maintenance-location-picker-modal__content" onSubmit={submit}>
          <MaintenanceEquipmentLocationSelect
            clientId={clientId}
            locationId={maintenanceLocationId}
            onCreated={handleCreated}
            value={selection?.id || ''}
            disabled={saving}
            onChange={(id, name, locationId, locationName) => setSelection({
              id: String(id || ''),
              name: String(name || ''),
              locationId: String(locationId || ''),
              locationName: String(locationName || ''),
              available: true,
              active: true,
              deviceCount: 0,
            })}
          />

          {duplicate && <div className="alert alert--warning"><Icon name="info" /><span>Esta ubicación ya forma parte del mantenimiento.</span></div>}
          {!duplicate && inventoryPreview?.generated && !projectMode && <label className="maintenance-location-picker-modal__inventory-copy">
            <input type="checkbox" checked={includeInventoryDevices}
              disabled={saving || inventoryLoading || inventoryPreview.count < 1}
              onChange={(event) => setIncludeInventoryDevices(event.target.checked)} />
            <span><strong>Agregar también los dispositivos del inventario</strong>
              <small>{inventoryPreview.count > 0
                ? inventoryPreview.count + ' equipo(s) registrados en esta ubicación. Se copiarán nombre, tipo, fabricante, modelo, serie y MAC.'
                : 'Esta ubicación todavía no tiene dispositivos en el inventario.'}</small>
              <small>Se crearán como pendientes, sin reutilizar checklists, fotos ni resultados de visitas anteriores.</small>
            </span>
          </label>}
          {inventoryLoading && selection?.id && !duplicate && <p className="field-hint">Consultando dispositivos de esta ubicación…</p>}
          {!selection?.id && <div className="info-box"><Icon name="location_on" /><p>Seleccione una ubicación existente o use el botón de agregar del campo para crear una nueva en la ficha del cliente.</p></div>}

          <div className="form-actions">
            <button className="button button--secondary" type="button" onClick={close} disabled={saving}>Cancelar</button>
            <button className="button button--primary" disabled={saving || !selection?.id || duplicate || (includeInventoryDevices && inventoryLoading)}><Icon name={saving ? 'progress_activity' : 'add'} />{saving ? 'Agregando...' : 'Agregar ubicación'}</button>
          </div>
        </form>
      </section>
      <ProcessingOverlay
        open={saving}
        title="Agregando ubicación"
        message="Se está vinculando la ubicación con el mantenimiento y actualizando el inventario."
      />
    </div>
  );
}
