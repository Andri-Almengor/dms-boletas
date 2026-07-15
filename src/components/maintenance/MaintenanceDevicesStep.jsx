import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';

const PAGE_SIZE = 25;

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function MaintenanceDevicesStep({ devices, expectedTotal, disabled, canCreateEquipment, onAddEquipment, onAddDevice, onOpenDevice }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const categories = useMemo(() => [...new Set(devices.map((device) => device.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [devices]);
  const filtered = useMemo(() => {
    const needle = normalize(query);
    return devices.filter((device) => (!category || device.categoria === category)
      && (!needle || normalize([device.nombre, device.categoria, device.zona, device.fabricante, device.modelo, device.serie, device.estado].join(' ')).includes(needle)));
  }, [category, devices, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [query, category]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <div className="stack-form maintenance-device-step">
      <div className="maintenance-device-summary">
        <div><strong>{devices.length}</strong><span>dispositivos registrados</span></div>
        <div><strong>{expectedTotal}</strong><span>dispositivos esperados</span></div>
        {canCreateEquipment && <button className="button button--secondary button--compact" type="button" onClick={onAddEquipment} disabled={disabled}><Icon name="add_location_alt" />Nueva ubicación de equipo</button>}
      </div>

      <div className="maintenance-device-step__actions">
        <label className="maintenance-device-step__search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar dispositivo, zona, modelo o serie..." /></label>
        <select className="form-control" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Todas las categorías</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {!disabled && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar dispositivo</button>}
      </div>

      <div className="maintenance-device-compact-list">
        {visible.map((device, index) => (
          <button className="maintenance-device-compact-row" type="button" key={device.localId} onClick={() => onOpenDevice(device)}>
            <span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(device.categoria).icon} /></span>
            <span className="maintenance-device-compact-row__identity"><strong>{device.nombre || 'Dispositivo sin nombre'}</strong><small>{device.categoria || 'Sin categoría'}</small></span>
            <span data-label="Ubicación"><strong>{device.zona || 'Sin ubicación'}</strong></span>
            <span data-label="Modelo / serie"><strong>{[device.modelo, device.serie].filter(Boolean).join(' · ') || 'Sin datos'}</strong></span>
            <span data-label="Evidencias"><strong>{device.images.length + device.newImages.length}</strong></span>
            <span className="maintenance-device-compact-row__number">#{(page - 1) * PAGE_SIZE + index + 1}</span>
            <Icon name="chevron_right" />
          </button>
        ))}

        {!visible.length && (
          <div className="empty-state">
            <Icon name="devices_other" />
            <h3>{devices.length ? 'No hay coincidencias' : 'Sin dispositivos'}</h3>
            <p>{devices.length ? 'Cambie la búsqueda o la categoría.' : 'El mantenimiento puede guardarse vacío y completar los equipos después.'}</p>
            {!devices.length && !disabled && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar primer dispositivo</button>}
          </div>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <nav className="maintenance-device-browser__pagination">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><Icon name="chevron_left" />Anterior</button>
          <span>Página <strong>{page}</strong> de <strong>{totalPages}</strong> · {filtered.length} dispositivos</span>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>Siguiente<Icon name="chevron_right" /></button>
        </nav>
      )}
    </div>
  );
}
