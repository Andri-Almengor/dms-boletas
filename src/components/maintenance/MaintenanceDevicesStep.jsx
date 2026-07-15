import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';

const PAGE_SIZES = [25, 50, 100];

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isOfflineDevice(device) {
  return Boolean(device.OfflinePendiente)
    || String(device.id || device.localId || '').startsWith('dispositivo-');
}

function evidenceCount(device) {
  return Number(device.images?.length || 0) + Number(device.newImages?.length || 0);
}

function deviceState(device) {
  const text = normalized(device.estado);
  if (!text) return 'SIN ESTADO';
  return text === 'correcto' || text.startsWith('si') ? 'CORRECTO' : String(device.estado).toUpperCase();
}

export default function MaintenanceDevicesStep({
  devices,
  expectedTotal,
  disabled,
  canCreateEquipment,
  onAddEquipment,
  onAddDevice,
  onOpenDevice,
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [stateFilter, setStateFilter] = useState('TODOS');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const categories = useMemo(() => [...new Set(devices.map((item) => item.categoria).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'es')), [devices]);

  const filtered = useMemo(() => {
    const search = normalized(query);
    return devices.filter((device) => {
      if (category !== 'TODAS' && device.categoria !== category) return false;
      const currentState = deviceState(device);
      if (stateFilter === 'CORRECTOS' && currentState !== 'CORRECTO') return false;
      if (stateFilter === 'ATENCION' && currentState === 'CORRECTO') return false;
      if (!search) return true;
      return [
        device.nombre,
        device.categoria,
        device.zona,
        device.fabricante,
        device.modelo,
        device.serie,
        device.estado,
      ].some((value) => normalized(value).includes(search));
    });
  }, [devices, query, category, stateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [query, category, stateFilter, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const correct = devices.filter((item) => deviceState(item) === 'CORRECTO').length;
  const evidenceTotal = devices.reduce((sum, item) => sum + evidenceCount(item), 0);

  return (
    <div className="maintenance-device-manager">
      <section className="maintenance-device-summary maintenance-device-summary--compact">
        <div><strong>{devices.length}</strong><span>registrados</span></div>
        <div><strong>{expectedTotal}</strong><span>esperados</span></div>
        <div><strong>{correct}</strong><span>correctos</span></div>
        <div><strong>{evidenceTotal}</strong><span>evidencias</span></div>
      </section>

      <div className="maintenance-device-manager__actions">
        {!disabled && (
          <button className="button button--primary" type="button" onClick={onAddDevice}>
            <Icon name="add" />Agregar dispositivo
          </button>
        )}
        {canCreateEquipment && (
          <button className="button button--secondary" type="button" onClick={onAddEquipment} disabled={disabled}>
            <Icon name="add_location_alt" />Nueva ubicación de equipo
          </button>
        )}
      </div>

      <div className="maintenance-device-toolbar">
        <label className="maintenance-device-search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nombre, zona, modelo o serie..."
          />
        </label>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoría">
          <option value="TODAS">Todas las categorías</option>
          {categories.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filtrar por estado">
          <option value="TODOS">Todos los estados</option>
          <option value="CORRECTOS">Correctos</option>
          <option value="ATENCION">Requieren atención</option>
        </select>
        <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Filas por página">
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}
        </select>
      </div>

      <div className="maintenance-device-category-chips" aria-label="Resumen por categoría">
        <button type="button" className={category === 'TODAS' ? 'is-active' : ''} onClick={() => setCategory('TODAS')}>
          Todos <span>{devices.length}</span>
        </button>
        {categories.map((name) => (
          <button type="button" key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>
            {name} <span>{devices.filter((item) => item.categoria === name).length}</span>
          </button>
        ))}
      </div>

      {visible.length ? (
        <>
          <div className="maintenance-device-table-wrap">
            <table className="maintenance-device-table">
              <thead><tr><th>#</th><th>Dispositivo</th><th>Categoría</th><th>Ubicación</th><th>Modelo / Serie</th><th>Estado</th><th>Evidencias</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {visible.map((device, index) => {
                  const number = (page - 1) * pageSize + index + 1;
                  const offline = isOfflineDevice(device);
                  return (
                    <tr key={device.localId || device.id}>
                      <td className="maintenance-device-table__number">{number}</td>
                      <td><button type="button" className="maintenance-device-name-button" onClick={() => onOpenDevice(device)}><span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(device.categoria).icon} /></span><span><strong>{device.nombre || 'Dispositivo sin nombre'}</strong>{offline && <small><Icon name="cloud_off" />Pendiente de sincronizar</small>}</span></button></td>
                      <td>{device.categoria || 'Sin categoría'}</td>
                      <td>{device.zona || 'Sin ubicación'}</td>
                      <td>{[device.modelo, device.serie].filter(Boolean).join(' · ') || 'Sin datos'}</td>
                      <td><span className={`maintenance-device-compact-state ${deviceState(device) === 'CORRECTO' ? 'is-good' : 'is-warning'}`}>{deviceState(device)}</span></td>
                      <td><span className="maintenance-device-evidence-count"><Icon name="photo_library" />{evidenceCount(device)}</span></td>
                      <td><button type="button" className="icon-button maintenance-device-open" onClick={() => onOpenDevice(device)} aria-label={`Abrir ${device.nombre || 'dispositivo'}`}><Icon name="chevron_right" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="maintenance-device-mobile-list">
            {visible.map((device, index) => (
              <button type="button" key={device.localId || device.id} className="maintenance-device-mobile-row" onClick={() => onOpenDevice(device)}>
                <span className="maintenance-device-mobile-row__number">{(page - 1) * pageSize + index + 1}</span>
                <span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(device.categoria).icon} /></span>
                <span className="maintenance-device-mobile-row__content">
                  <strong>{device.nombre || 'Dispositivo sin nombre'}</strong>
                  <small>{device.categoria || 'Sin categoría'} · {device.zona || 'Sin ubicación'}</small>
                  <span><em className={deviceState(device) === 'CORRECTO' ? 'is-good' : 'is-warning'}>{deviceState(device)}</em><em><Icon name="photo_library" />{evidenceCount(device)}</em>{isOfflineDevice(device) && <em className="is-offline"><Icon name="cloud_off" />Offline</em>}</span>
                </span>
                <Icon name="chevron_right" />
              </button>
            ))}
          </div>

          <nav className="maintenance-device-pagination" aria-label="Paginación de dispositivos">
            <span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} de {filtered.length}</span>
            <div>
              <button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><Icon name="chevron_left" /></button>
              <strong>{page} / {totalPages}</strong>
              <button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}><Icon name="chevron_right" /></button>
            </div>
          </nav>
        </>
      ) : (
        <div className="empty-state maintenance-device-empty">
          <Icon name="devices_other" />
          <h3>{devices.length ? 'No hay coincidencias' : 'Sin dispositivos registrados'}</h3>
          <p>{devices.length ? 'Cambie los filtros o el texto de búsqueda.' : 'Puede guardar el mantenimiento vacío y agregar equipos después.'}</p>
          {!disabled && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar primer dispositivo</button>}
        </div>
      )}
    </div>
  );
}
