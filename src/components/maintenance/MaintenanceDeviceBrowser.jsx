import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';

const PAGE_SIZES = [20, 50, 100];

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function answerClass(value) {
  const text = normalized(value);
  return text.startsWith('si') || text === 'correcto' ? 'is-good' : text ? 'is-bad' : '';
}

function answersOf(device) {
  try {
    return typeof device.RespuestasJSON === 'string'
      ? JSON.parse(device.RespuestasJSON || '{}')
      : device.RespuestasJSON || {};
  } catch {
    return {};
  }
}

function deviceSearchText(device) {
  return normalized([
    pick(device, ['NombreDispositivo', 'nombre']),
    pick(device, ['Categoria', 'TipoDispositivo']),
    pick(device, ['Zona']),
    pick(device, ['Fabricante']),
    pick(device, ['Modelo']),
    pick(device, ['Serie']),
    pick(device, ['Estado']),
    pick(device, ['Funcionamiento']),
    pick(device, ['EnUso']),
  ].join(' '));
}

export default function MaintenanceDeviceBrowser({
  devices,
  status,
  canEdit,
  sessionToken,
  onAddEvidence,
  onEditEvidence,
  onAddDevice,
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState('');

  const categories = useMemo(() => [...new Set(devices
    .map((device) => String(pick(device, ['Categoria', 'TipoDispositivo'], 'Sin categoría')))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [devices]);

  const filtered = useMemo(() => {
    const needle = normalized(query);
    return devices.filter((device) => {
      const deviceCategory = String(pick(device, ['Categoria', 'TipoDispositivo'], 'Sin categoría'));
      const deviceState = String(pick(device, ['Estado'], 'Sin estado'));
      return (!category || deviceCategory === category)
        && (!stateFilter || deviceState === stateFilter)
        && (!needle || deviceSearchText(device).includes(needle));
    });
  }, [category, devices, query, stateFilter]);

  const states = useMemo(() => [...new Set(devices
    .map((device) => String(pick(device, ['Estado'], 'Sin estado')))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [devices]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  useEffect(() => { setPage(1); }, [query, category, stateFilter, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  function toggle(deviceId) {
    setExpandedId((current) => current === deviceId ? '' : deviceId);
  }

  return (
    <section className="maintenance-device-browser">
      <header className="maintenance-device-browser__heading">
        <div>
          <span className="eyebrow">INVENTARIO DEL MANTENIMIENTO</span>
          <h2>Dispositivos registrados</h2>
          <p>{devices.length.toLocaleString('es-CR')} dispositivo{devices.length === 1 ? '' : 's'} · {filtered.length.toLocaleString('es-CR')} visible{filtered.length === 1 ? '' : 's'}</p>
        </div>
        {status === 'PENDIENTE' && canEdit && onAddDevice && (
          <button className="button button--primary" type="button" onClick={onAddDevice}>
            <Icon name="add" />Agregar dispositivo
          </button>
        )}
      </header>

      <div className="maintenance-device-browser__toolbar">
        <label className="maintenance-device-browser__search">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, zona, modelo o serie..." />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda"><Icon name="close" /></button>}
        </label>
        <select className="form-control" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="form-control" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          {states.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="form-control" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Dispositivos por página">
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}
        </select>
      </div>

      {visible.length ? (
        <div className="maintenance-device-browser__list">
          <div className="maintenance-device-browser__columns" aria-hidden="true">
            <span>Dispositivo</span><span>Ubicación</span><span>Modelo / Serie</span><span>Estado</span><span>Evidencias</span><span />
          </div>
          {visible.map((device, visibleIndex) => {
            const deviceId = String(pick(device, ['EvidenciaMantenimientoID', 'id'], `${page}-${visibleIndex}`));
            const deviceCategory = String(pick(device, ['Categoria', 'TipoDispositivo'], 'Sin categoría'));
            const config = getMaintenanceCategory(deviceCategory);
            const images = device.Imagenes || [];
            const answers = answersOf(device);
            const expanded = expandedId === deviceId;
            return (
              <article className={`maintenance-device-browser__item${expanded ? ' is-expanded' : ''}`} key={deviceId}>
                <button className="maintenance-device-browser__row" type="button" onClick={() => toggle(deviceId)} aria-expanded={expanded}>
                  <span className="maintenance-device-browser__identity">
                    <span className="maintenance-device-browser__icon"><Icon name={config.icon} /></span>
                    <span><strong>{pick(device, ['NombreDispositivo'], 'Dispositivo sin nombre')}</strong><small>{deviceCategory}</small></span>
                  </span>
                  <span className="maintenance-device-browser__cell" data-label="Ubicación"><strong>{pick(device, ['Zona'], 'Sin ubicación')}</strong></span>
                  <span className="maintenance-device-browser__cell" data-label="Modelo / Serie"><strong>{[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin datos'}</strong></span>
                  <span className="maintenance-device-browser__cell" data-label="Estado"><span className={`maintenance-device-state ${answerClass(pick(device, ['Estado']))}`}>{pick(device, ['Estado'], 'Sin estado')}</span></span>
                  <span className="maintenance-device-browser__cell" data-label="Evidencias"><strong>{images.length}</strong></span>
                  <Icon name={expanded ? 'expand_less' : 'expand_more'} />
                </button>

                {expanded && (
                  <div className="maintenance-device-browser__detail">
                    <div className="maintenance-device-browser__facts">
                      <div className={answerClass(pick(device, ['Funcionamiento']))}><span>Funcionamiento</span><strong>{pick(device, ['Funcionamiento'], 'Sin responder')}</strong></div>
                      <div className={answerClass(pick(device, ['EnUso']))}><span>En uso</span><strong>{pick(device, ['EnUso'], 'Sin responder')}</strong></div>
                      {config.questions.map(([key, label]) => (
                        <div className={answerClass(answers[key])} key={key}><span>{label.replace(/^¿|\?$/g, '')}</span><strong>{answers[key] || 'Sin responder'}</strong></div>
                      ))}
                    </div>

                    {pick(device, ['Observacion']) && <div className="maintenance-observation"><Icon name="notes" /><p>{pick(device, ['Observacion'])}</p></div>}

                    <div className="maintenance-device-browser__evidence-heading">
                      <div><strong>Evidencias</strong><span>{images.length} fotografía{images.length === 1 ? '' : 's'}</span></div>
                      {status === 'PENDIENTE' && canEdit && (
                        <button className="button button--secondary button--compact" type="button" onClick={() => onAddEvidence?.(device)}>
                          <Icon name="add_a_photo" />Agregar evidencia
                        </button>
                      )}
                    </div>

                    <div className="maintenance-device-browser__images">
                      {images.map((image) => (
                        <figure className="maintenance-evidence-card" key={pick(image, ['FotoDispositivoID', 'id'])}>
                          <MaintenanceEvidenceImage image={image} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
                          <figcaption><strong>{pick(image, ['Tipo'], 'Evidencia')}</strong><span>{pick(image, ['Nota'], 'Sin nota')}</span></figcaption>
                          {status === 'PENDIENTE' && canEdit && (
                            <button type="button" className="maintenance-evidence-edit-button" onClick={() => onEditEvidence?.({ image, device })}>
                              <Icon name="edit" />Editar
                            </button>
                          )}
                        </figure>
                      ))}
                      {!images.length && <div className="offline-empty-inline"><Icon name="photo_library" /><div><strong>Sin evidencias</strong><small>Puede agregar fotografías sin abrir todos los dispositivos.</small></div></div>}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="devices_other" />
          <h2>{devices.length ? 'No hay coincidencias' : 'Sin dispositivos registrados'}</h2>
          <p>{devices.length ? 'Cambie los filtros o el texto de búsqueda.' : 'Puede guardar el mantenimiento vacío y agregar dispositivos después.'}</p>
          {!devices.length && status === 'PENDIENTE' && canEdit && onAddDevice && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar primer dispositivo</button>}
        </div>
      )}

      {filtered.length > pageSize && (
        <nav className="maintenance-device-browser__pagination" aria-label="Paginación de dispositivos">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><Icon name="chevron_left" />Anterior</button>
          <span>Página <strong>{page}</strong> de <strong>{totalPages}</strong></span>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>Siguiente<Icon name="chevron_right" /></button>
        </nav>
      )}
    </section>
  );
}
