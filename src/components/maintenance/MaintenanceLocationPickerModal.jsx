import React, { useMemo, useState } from 'react';
import Icon from '../common/Icon';
import MaintenanceEquipmentLocationSelect from './MaintenanceEquipmentLocationSelect';

export default function MaintenanceLocationPickerModal({
  open,
  maintenanceLocationId,
  existingLocations = [],
  onClose,
  onSave,
  saving = false,
}) {
  const [selection, setSelection] = useState(null);
  const existingIds = useMemo(
    () => new Set(existingLocations.map((item) => String(item.id || item.UbicacionEquipoID || '')).filter(Boolean)),
    [existingLocations],
  );

  if (!open) return null;

  const duplicate = selection?.id && existingIds.has(selection.id);

  async function submit(event) {
    event.preventDefault();
    if (!selection?.id || duplicate) return;
    await onSave?.(selection);
    setSelection(null);
  }

  function close() {
    if (saving) return;
    setSelection(null);
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
            locationId={maintenanceLocationId}
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
          {!selection?.id && <div className="info-box"><Icon name="location_on" /><p>Seleccione una ubicación existente o use el botón de agregar del campo para crear una nueva en la ficha del cliente.</p></div>}

          <div className="form-actions">
            <button className="button button--secondary" type="button" onClick={close} disabled={saving}>Cancelar</button>
            <button className="button button--primary" disabled={saving || !selection?.id || duplicate}><Icon name={saving ? 'progress_activity' : 'add'} />{saving ? 'Agregando...' : 'Agregar ubicación'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
