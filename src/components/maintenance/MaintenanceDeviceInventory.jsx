import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import FilterDrawer from '../forms/FilterDrawer';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';
import {
  effectiveMaintenanceDeviceState,
  isMaintenanceChecklistPending,
} from '../../utils/maintenanceChecklistStatus';

const PAGE_SIZES = [25, 50, 100];
const NATURAL_COLLATOR = new Intl.Collator('es', {
  numeric: true,
  sensitivity: 'base',
  ignorePunctuation: true,
});

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function naturalCompare(left, right) {
  return NATURAL_COLLATOR.compare(String(left || ''), String(right || ''));
}

function uniqueSorted(values, fallback) {
  const labels = new Map();
  values.forEach((value) => {
    const label = String(value || '').trim() || fallback;
    const key = normalized(label);
    if (!labels.has(key)) labels.set(key, label);
  });
  return [...labels.values()].sort(naturalCompare);
}

function deviceType(device) {
  return pick(device, ['Categoria', 'TipoDispositivoNombre', 'TipoDispositivo', 'deviceTypeName'], 'Sin categoría');
}

function deviceLocation(device) {
  return pick(device, [
    'UbicacionEquipoNombre',
    'UbicacionEquipo',
    'Ubicación del equipo',
    'Zona',
    'Ubicacion',
    'equipmentLocationName',
  ], 'Sin ubicación');
}

function deviceName(device) {
  return pick(device, ['NombreDispositivo', 'nombre', 'name'], 'Dispositivo');
}

function compareDevices(left, right) {
  return naturalCompare(deviceLocation(left), deviceLocation(right))
    || naturalCompare(deviceName(left), deviceName(right))
    || naturalCompare(deviceType(left), deviceType(right))
    || naturalCompare(pick(left, ['Serie']), pick(right, ['Serie']))
    || naturalCompare(deviceId(left), deviceId(right));
}

function groupVisibleDevices(items, page, pageSize) {
  const groups = new Map();
  items.forEach((device, index) => {
    const label = String(deviceLocation(device) || 'Sin ubicación').trim() || 'Sin ubicación';
    const key = normalized(label) || 'sin-ubicacion';
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push({
      device,
      absoluteIndex: ((page - 1) * pageSize) + index,
    });
  });
  return [...groups.values()];
}

function stateClass(value) {
  const text = normalized(value);
  if (text.startsWith('si') || text === 'correcto') return 'is-good';
  return text ? 'is-warning' : 'is-empty';
}

function stateText(value) {
  return String(value || 'Sin estado').toUpperCase();
}

function checklistQuestions(device) {
  return getMaintenanceCategory(deviceType(device)).questions;
}

function effectiveState(device) {
  return effectiveMaintenanceDeviceState(device, checklistQuestions(device));
}

function isChecklistPending(device) {
  return isMaintenanceChecklistPending(device, checklistQuestions(device));
}

function stateFilterLabel(value) {
  if (value === 'CORRECTOS') return 'Correctos';
  if (value === 'PENDIENTES') return 'Pendientes';
  if (value === 'ATENCION') return 'Requieren atención';
  return 'Todos los estados';
}

function parseAnswers(device) {
  try {
    return typeof device.RespuestasJSON === 'string'
      ? JSON.parse(device.RespuestasJSON || '{}')
      : device.RespuestasJSON || {};
  } catch {
    return {};
  }
}

function deviceId(device) {
  return String(pick(device, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
}

function isOffline(device) {
  return Boolean(device.OfflinePendiente)
    || (device.Imagenes || []).some((image) => Boolean(image.OfflinePendiente));
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      <select className="form-control" value={value} onChange={onChange}>{children}</select>
    </label>
  );
}

export default function MaintenanceDeviceInventory({
  devices,
  status,
  canEdit,
  sessionToken,
  onAddDevice,
  onEditDevice,
  onAddEvidence,
  onEditEvidence,
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [location, setLocation] = useState('TODAS');
  const [stateFilter, setStateFilter] = useState('TODOS');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState('');
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const categories = useMemo(
    () => uniqueSorted(devices.map((item) => deviceType(item)), 'Sin categoría'),
    [devices],
  );

  const locations = useMemo(
    () => uniqueSorted(devices.map((item) => deviceLocation(item)), 'Sin ubicación'),
    [devices],
  );

  const filtered = useMemo(() => {
    const search = normalized(query);
    const selectedCategory = normalized(category);
    const selectedLocation = normalized(location);
    return devices
      .filter((device) => {
        const currentCategory = deviceType(device);
        const currentLocation = deviceLocation(device);
        const currentEffectiveState = effectiveState(device);
        const currentState = stateClass(currentEffectiveState);
        const checklistPending = isChecklistPending(device);
        if (category !== 'TODAS' && normalized(currentCategory) !== selectedCategory) return false;
        if (location !== 'TODAS' && normalized(currentLocation) !== selectedLocation) return false;
        if (stateFilter === 'PENDIENTES' && !checklistPending) return false;
        if (stateFilter === 'CORRECTOS' && (checklistPending || currentState !== 'is-good')) return false;
        if (stateFilter === 'ATENCION' && (checklistPending || currentState === 'is-good')) return false;
        if (!search) return true;
        return [
          deviceName(device),
          currentCategory,
          currentLocation,
          pick(device, ['Fabricante']),
          pick(device, ['Modelo']),
          pick(device, ['Serie']),
          pick(device, ['Estado']),
          currentEffectiveState,
          pick(device, ['Observacion']),
        ].some((value) => normalized(value).includes(search));
      })
      .sort(compareDevices);
  }, [devices, query, category, location, stateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const visibleGroups = useMemo(
    () => groupVisibleDevices(visible, page, pageSize),
    [visible, page, pageSize],
  );
  const pending = status === 'PENDIENTE';
  const pendingDeviceCount = useMemo(
    () => devices.filter(isChecklistPending).length,
    [devices],
  );
  const activeFilterCount = Number(category !== 'TODAS')
    + Number(location !== 'TODAS')
    + Number(stateFilter !== 'TODOS')
    + Number(pageSize !== 25);

  useEffect(() => { setPage(1); }, [query, category, location, stateFilter, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  useEffect(() => {
    setOpenGroups(new Set());
    setExpanded('');
  }, [query, category, location, stateFilter, pageSize, page]);

  function toggle(device) {
    const id = deviceId(device);
    setExpanded((current) => current === id ? '' : id);
  }

  function toggleLocationGroup(group) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(group.key)) {
        next.delete(group.key);
        if (group.items.some(({ device }) => deviceId(device) === expanded)) setExpanded('');
      } else {
        next.add(group.key);
      }
      return next;
    });
  }

  function clearFilters() {
    setCategory('TODAS');
    setLocation('TODAS');
    setStateFilter('TODOS');
    setPageSize(25);
    setFilterOpen(false);
  }

  function expandedContent(device) {
    const categoryName = deviceType(device);
    const config = getMaintenanceCategory(categoryName);
    const answers = parseAnswers(device);
    const images = device.Imagenes || [];
    const id = deviceId(device);
    const checklistPending = isChecklistPending(device);
    return (
      <div className="maintenance-inventory-expanded">
        <div className="maintenance-inventory-expanded__heading">
          <div>
            <span className="eyebrow">Detalle del dispositivo</span>
            <strong>{deviceName(device)}</strong>
          </div>
          {pending && canEdit && (
            <button className="button button--secondary button--compact" type="button" onClick={() => onEditDevice(device)}>
              <Icon name="edit" />Editar dispositivo
            </button>
          )}
        </div>
        {checklistPending && (
          <div className="maintenance-inventory-pending-note">
            <Icon name="schedule" />
            <div><strong>Checklist pendiente</strong><span>Falta completar una o más respuestas obligatorias de este dispositivo.</span></div>
          </div>
        )}
        <div className={`maintenance-inventory-checklist${checklistPending ? ' is-pending' : ''}`}>
          <div className={stateClass(pick(device, ['Funcionamiento']))}><span>Funcionamiento</span><strong>{pick(device, ['Funcionamiento'], 'Sin responder')}</strong></div>
          <div className={stateClass(pick(device, ['EnUso']))}><span>En uso</span><strong>{pick(device, ['EnUso'], 'Sin responder')}</strong></div>
          {config.questions.map(([key, label]) => (
            <div className={stateClass(answers[key])} key={key}><span>{label.replace(/^¿|\?$/g, '')}</span><strong>{answers[key] || 'Sin responder'}</strong></div>
          ))}
        </div>
        {pick(device, ['Observacion']) && <div className="maintenance-inventory-observation"><Icon name="notes" /><p>{pick(device, ['Observacion'])}</p></div>}
        <div className="maintenance-inventory-evidence-heading">
          <div><strong>Evidencias</strong><span>{images.length} fotografía{images.length === 1 ? '' : 's'}</span></div>
          {pending && canEdit && <button className="button button--secondary button--compact" type="button" onClick={() => onAddEvidence(device)}><Icon name="add_a_photo" />Agregar</button>}
        </div>
        <div className="maintenance-inventory-images">
          {images.map((image) => (
            <figure key={pick(image, ['FotoDispositivoID', 'id'])}>
              <MaintenanceEvidenceImage image={image} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
              <figcaption><strong>{pick(image, ['Tipo'], 'Evidencia')}</strong><span>{pick(image, ['Nota'], 'Sin nota')}</span></figcaption>
              {pending && canEdit && <button type="button" onClick={() => onEditEvidence(image, device)}><Icon name="edit" />Editar evidencia</button>}
            </figure>
          ))}
          {!images.length && <div className="maintenance-inventory-no-images"><Icon name="photo_library" /><span>Sin fotografías registradas.</span></div>}
        </div>
        {isOffline(device) && <div className="maintenance-inventory-offline-note"><Icon name="cloud_off" />Este dispositivo y sus evidencias están guardados en este equipo y se enviarán al recuperar conexión.</div>}
        <span className="maintenance-inventory-device-id">ID: {id}</span>
      </div>
    );
  }

  const drawerFields = (
    <>
      <FilterSelect label="Tipo de dispositivo" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="TODAS">Todos los tipos</option>
        {categories.map((name) => <option key={name} value={name}>{name}</option>)}
      </FilterSelect>
      <FilterSelect label="Ubicación del equipo" value={location} onChange={(event) => setLocation(event.target.value)}>
        <option value="TODAS">Todas las ubicaciones</option>
        {locations.map((name) => <option key={name} value={name}>{name}</option>)}
      </FilterSelect>
      <FilterSelect label="Estado" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
        <option value="TODOS">Todos los estados</option>
        <option value="PENDIENTES">Pendientes de checklist</option>
        <option value="CORRECTOS">Correctos</option>
        <option value="ATENCION">Requieren atención</option>
      </FilterSelect>
      <FilterSelect label="Dispositivos por página" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
        {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}
      </FilterSelect>
    </>
  );

  return (
    <section className="maintenance-inventory-panel">
      <div className="maintenance-inventory-heading">
        <div><span className="eyebrow">INVENTARIO TÉCNICO</span><h2>Dispositivos del mantenimiento</h2><p>Abra una ubicación para ver sus equipos, ordenados alfabética y numéricamente.</p></div>
        {pending && canEdit && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar dispositivo</button>}
      </div>

      <div className="maintenance-device-toolbar maintenance-device-toolbar--detail">
        <label className="maintenance-device-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, ubicación, tipo, modelo, serie, estado u observación..." /></label>
        <button type="button" className="icon-button icon-button--primary maintenance-inventory-filter-trigger" onClick={() => setFilterOpen(true)} aria-label="Abrir filtros de dispositivos">
          <Icon name="tune" />
          {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        </button>
        <select className="maintenance-inventory-inline-filter" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por tipo de dispositivo"><option value="TODAS">Todos los tipos</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select className="maintenance-inventory-inline-filter" value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filtrar por ubicación del equipo"><option value="TODAS">Todas las ubicaciones</option>{locations.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select className="maintenance-inventory-inline-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filtrar por estado"><option value="TODOS">Todos los estados</option><option value="PENDIENTES">Pendientes</option><option value="CORRECTOS">Correctos</option><option value="ATENCION">Requieren atención</option></select>
        <select className="maintenance-inventory-inline-filter" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Filas por página">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}</select>
      </div>

      <div className="maintenance-device-category-chips">
        <button type="button" className={category === 'TODAS' ? 'is-active' : ''} onClick={() => setCategory('TODAS')}>Todos <span>{devices.length}</span></button>
        {pendingDeviceCount > 0 && <button type="button" className={stateFilter === 'PENDIENTES' ? 'is-active is-pending' : 'is-pending'} onClick={() => setStateFilter((current) => current === 'PENDIENTES' ? 'TODOS' : 'PENDIENTES')}><Icon name="schedule" />Pendientes <span>{pendingDeviceCount}</span></button>}
        {categories.map((name) => <button type="button" key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name} <span>{devices.filter((item) => normalized(deviceType(item)) === normalized(name)).length}</span></button>)}
      </div>

      {(category !== 'TODAS' || location !== 'TODAS' || stateFilter !== 'TODOS') && (
        <div className="maintenance-inventory-active-filters" aria-live="polite">
          <span><strong>{filtered.length}</strong> de {devices.length} dispositivos</span>
          {category !== 'TODAS' && <button type="button" onClick={() => setCategory('TODAS')}><Icon name="devices_other" />{category}<Icon name="close" /></button>}
          {location !== 'TODAS' && <button type="button" onClick={() => setLocation('TODAS')}><Icon name="location_on" />{location}<Icon name="close" /></button>}
          {stateFilter !== 'TODOS' && <button type="button" onClick={() => setStateFilter('TODOS')}><Icon name={stateFilter === 'PENDIENTES' ? 'schedule' : 'rule'} />{stateFilterLabel(stateFilter)}<Icon name="close" /></button>}
        </div>
      )}

      {visible.length ? (
        <>
          <div className="maintenance-inventory-table-wrap">
            <table className="maintenance-inventory-table">
              <thead><tr><th>#</th><th>Nombre</th><th>Tipo</th><th>Ubicación del equipo</th><th>Modelo / Serie</th><th>Estado</th><th>Fotos</th><th>Acciones</th></tr></thead>
              <tbody>
                {visibleGroups.map((group) => {
                  const groupOpen = openGroups.has(group.key);
                  return (
                    <React.Fragment key={group.key}>
                      <tr className={`maintenance-inventory-location-row${groupOpen ? ' is-open' : ''}`}>
                        <td colSpan="8">
                          <button
                            type="button"
                            className="maintenance-inventory-location-toggle"
                            onClick={() => toggleLocationGroup(group)}
                            aria-expanded={groupOpen}
                            aria-label={`${groupOpen ? 'Cerrar' : 'Abrir'} ubicación ${group.label}`}
                          >
                            <span className="maintenance-inventory-location-toggle__icon"><Icon name="location_on" /></span>
                            <span className="maintenance-inventory-location-toggle__text"><strong>{group.label}</strong><small>{group.items.length} equipo{group.items.length === 1 ? '' : 's'} en esta página</small></span>
                            <Icon name={groupOpen ? 'expand_less' : 'expand_more'} />
                          </button>
                        </td>
                      </tr>
                      {groupOpen && group.items.map(({ device, absoluteIndex }) => {
                        const id = deviceId(device);
                        const open = expanded === id;
                        const images = device.Imagenes || [];
                        const displayedState = effectiveState(device);
                        return (
                          <React.Fragment key={id}>
                            <tr className={open ? 'is-expanded' : ''}>
                              <td>{absoluteIndex + 1}</td>
                              <td><button type="button" className="maintenance-inventory-name" onClick={() => toggle(device)}><span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(deviceType(device)).icon} /></span><span><strong>{deviceName(device)}</strong>{isOffline(device) && <small><Icon name="cloud_off" />Offline</small>}</span></button></td>
                              <td>{deviceType(device)}</td>
                              <td>{deviceLocation(device)}</td>
                              <td>{[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin datos'}</td>
                              <td><span className={`maintenance-device-compact-state ${stateClass(displayedState)}${isChecklistPending(device) ? ' is-pending' : ''}`}>{stateText(displayedState)}</span></td>
                              <td><span className="maintenance-device-evidence-count"><Icon name="photo_library" />{images.length}</span></td>
                              <td>
                                <div className="maintenance-inventory-row-actions">
                                  {pending && canEdit && <button type="button" className="icon-button" onClick={() => onEditDevice(device)} aria-label={`Editar ${deviceName(device)}`}><Icon name="edit" /></button>}
                                  <button type="button" className="icon-button" onClick={() => toggle(device)} aria-expanded={open} aria-label={`Ver detalle de ${deviceName(device)}`}><Icon name={open ? 'expand_less' : 'expand_more'} /></button>
                                </div>
                              </td>
                            </tr>
                            {open && <tr className="maintenance-inventory-expanded-row"><td colSpan="8">{expandedContent(device)}</td></tr>}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="maintenance-inventory-mobile-list">
            {visibleGroups.map((group) => {
              const groupOpen = openGroups.has(group.key);
              return (
                <section className={`maintenance-inventory-location-group${groupOpen ? ' is-open' : ''}`} key={group.key}>
                  <button
                    type="button"
                    className="maintenance-inventory-location-group__heading"
                    onClick={() => toggleLocationGroup(group)}
                    aria-expanded={groupOpen}
                    aria-label={`${groupOpen ? 'Cerrar' : 'Abrir'} ubicación ${group.label}`}
                  >
                    <span><Icon name="location_on" /></span>
                    <div><strong>{group.label}</strong><small>{group.items.length} equipo{group.items.length === 1 ? '' : 's'} en esta página</small></div>
                    <Icon name={groupOpen ? 'expand_less' : 'expand_more'} />
                  </button>
                  {groupOpen && (
                    <div className="maintenance-inventory-location-group__devices">
                      {group.items.map(({ device, absoluteIndex }) => {
                        const id = deviceId(device);
                        const open = expanded === id;
                        const displayedState = effectiveState(device);
                        return <article key={id} className={`maintenance-inventory-mobile-card${open ? ' is-expanded' : ''}${isChecklistPending(device) ? ' is-pending' : ''}`}>
                          <button type="button" className="maintenance-inventory-mobile-toggle" onClick={() => toggle(device)} aria-expanded={open}>
                            <span className="maintenance-device-mobile-row__number">{absoluteIndex + 1}</span>
                            <span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(deviceType(device)).icon} /></span>
                            <span><strong>{deviceName(device)}</strong><small>{deviceType(device)} · {deviceLocation(device)}</small><span><em className={`${stateClass(displayedState)}${isChecklistPending(device) ? ' is-pending' : ''}`}>{stateText(displayedState)}</em><em><Icon name="photo_library" />{(device.Imagenes || []).length}</em>{isOffline(device) && <em className="is-offline"><Icon name="cloud_off" />Offline</em>}</span></span>
                            <Icon name={open ? 'expand_less' : 'expand_more'} />
                          </button>
                          {pending && canEdit && <button type="button" className="maintenance-inventory-mobile-edit" onClick={() => onEditDevice(device)}><Icon name="edit" />Editar dispositivo y evidencias</button>}
                          {open && expandedContent(device)}
                        </article>;
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <nav className="maintenance-device-pagination" aria-label="Paginación de dispositivos">
            <span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} de {filtered.length}</span>
            <div><button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><Icon name="chevron_left" /></button><strong>{page} / {totalPages}</strong><button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}><Icon name="chevron_right" /></button></div>
          </nav>
        </>
      ) : (
        <div className="empty-state maintenance-device-empty"><Icon name="devices_other" /><h2>{devices.length ? 'No hay coincidencias' : 'Sin dispositivos registrados'}</h2><p>{devices.length ? 'Cambie la ubicación, el tipo de dispositivo o los demás filtros para ver otros equipos.' : 'Este mantenimiento puede guardarse vacío. Agregue el primer equipo cuando esté listo.'}</p>{pending && canEdit && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar primer dispositivo</button>}</div>
      )}

      <FilterDrawer open={filterOpen} title="Filtros de dispositivos" onClose={() => setFilterOpen(false)} onApply={() => { setPage(1); setFilterOpen(false); }} onClear={clearFilters}>
        {drawerFields}
      </FilterDrawer>
    </section>
  );
}
