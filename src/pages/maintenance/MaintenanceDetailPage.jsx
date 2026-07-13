import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import MaintenanceEvidenceEditor from '../../components/maintenance/MaintenanceEvidenceEditor';
import MaintenanceEvidenceImage from '../../components/maintenance/MaintenanceEvidenceImage';
import MaintenanceEvidenceUploader from '../../components/maintenance/MaintenanceEvidenceUploader';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

function date(value) {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'long' }).format(parsed);
}

function answerClass(value) {
  const text = String(value || '').toLowerCase();
  return text.startsWith('sí') || text === 'correcto' ? 'is-good' : text ? 'is-bad' : '';
}

export default function MaintenanceDetailPage() {
  const { maintenanceId } = useParams();
  const navigate = useNavigate();
  const { sessionToken, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR') || hasPermission('MANTENIMIENTOS_ELIMINAR');
  const canEdit = hasPermission('MANTENIMIENTOS_EDITAR') || hasPermission('BOLETAS_EDITAR');
  const canFinalize = hasPermission('MANTENIMIENTOS_FINALIZAR') || hasPermission('BOLETAS_FINALIZAR') || canEdit;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [expandedCategories, setExpandedCategories] = useState([]);
  const [evidenceDevice, setEvidenceDevice] = useState(null);
  const [quickEvidenceOpen, setQuickEvidenceOpen] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState(null);

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      setData(await requestAvailable(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceId, sessionToken]);

  const row = data?.mantenimiento || data || {};
  const devices = data?.dispositivos || data?.devices || [];
  const status = String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase();
  const grouped = useMemo(() => devices.reduce((map, device) => {
    const key = pick(device, ['Categoria'], 'Sin categoría');
    if (!map[key]) map[key] = [];
    map[key].push(device);
    return map;
  }, {}), [devices]);
  const categoryNames = useMemo(() => Object.keys(grouped), [grouped]);

  useEffect(() => {
    setExpandedCategories((current) => {
      const valid = current.filter((category) => categoryNames.includes(category));
      return valid.length || !categoryNames.length ? valid : [categoryNames[0]];
    });
  }, [categoryNames]);

  function toggleCategory(category) {
    setExpandedCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  }

  async function action(type) {
    if (type === 'delete' && !window.confirm('¿Eliminar este mantenimiento y todos sus dispositivos?')) return;
    if (type === 'finalize' && !window.confirm('¿Finalizar este mantenimiento? Después quedará en modo consulta.')) return;
    setWorking(type);
    setError('');
    try {
      if (type === 'finalize') await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId }, sessionToken);
      if (type === 'reopen') await requestAvailable(MODULE_ROUTES.maintenance.reopen, { maintenanceId }, sessionToken);
      if (type === 'delete') {
        await requestAvailable(MODULE_ROUTES.maintenance.delete, { maintenanceId }, sessionToken);
        navigate('/mantenimientos');
        return;
      }
      if (type === 'sheet') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.reportSpreadsheet, { maintenanceId }, sessionToken);
        window.open(pick(result, ['spreadsheetUrl', 'url']), '_blank', 'noopener,noreferrer');
      }
      if (type === 'slides') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.reportSlides, { maintenanceId }, sessionToken);
        window.open(pick(result, ['slidesUrl', 'url']), '_blank', 'noopener,noreferrer');
      }
      await load({ silent: true });
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setWorking('');
    }
  }

  if (loading) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimiento...</div></div>;
  }

  if (!data) {
    return <div className="page"><div className="empty-state"><Icon name="error" /><h2>No se encontró el mantenimiento</h2><p>{error}</p></div></div>;
  }

  return (
    <div className="page maintenance-detail-page">
      <div className="page-header knowledge-detail-header">
        <button className="icon-button" type="button" onClick={() => navigate('/mantenimientos')}><Icon name="arrow_back" /></button>
        <div><span className="eyebrow">Mantenimiento técnico</span><h1>{pick(row, ['TituloMantenimiento'], 'Mantenimiento')}</h1></div>
        {status === 'PENDIENTE' && canEdit
          ? <Link className="icon-button" to={`/mantenimientos/${encodeURIComponent(maintenanceId)}/editar`} aria-label="Editar"><Icon name="edit" /></Link>
          : <span />}
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      <section className="maintenance-detail-summary">
        <div className="maintenance-detail-summary__hero">
          <span className="maintenance-card__icon"><Icon name="engineering" /></span>
          <div>
            <span className={`status-chip ${status === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{status}</span>
            <h2>{pick(row, ['Cliente', 'ClienteRef'], 'Sin cliente')}</h2>
            <p>{pick(row, ['DescripcionGeneral'], 'Sin descripción general')}</p>
          </div>
        </div>
        <div className="maintenance-detail-summary__grid">
          <div><Icon name="calendar_month" /><span>Fecha</span><strong>{date(pick(row, ['Fecha']))}</strong></div>
          <div><Icon name="event_available" /><span>Finalización</span><strong>{date(pick(row, ['FechaFinalizacion']))}</strong></div>
          <div><Icon name="location_on" /><span>Ubicación</span><strong>{pick(row, ['Ubicacion'], 'Sin ubicación')}</strong></div>
          <div><Icon name="groups" /><span>Responsables</span><strong>{pick(row, ['Responsables', 'Responsable'], 'Sin responsables')}</strong></div>
        </div>
      </section>

      {(isAdmin || (status === 'PENDIENTE' && canEdit)) && (
        <section className="maintenance-report-actions" aria-label="Acciones del mantenimiento">
          {isAdmin && (
            <>
              <button type="button" className="button button--secondary" onClick={() => action('sheet')} disabled={Boolean(working)}>
                <Icon name="table_view" />{working === 'sheet' ? 'Generando...' : 'Crear Excel'}
              </button>
              <button type="button" className="button button--secondary" onClick={() => action('slides')} disabled={Boolean(working)}>
                <Icon name="slideshow" />{working === 'slides' ? 'Generando...' : 'Crear presentación'}
              </button>
            </>
          )}
          {status === 'PENDIENTE' && canEdit && (
            <button
              type="button"
              className="button button--primary maintenance-quick-evidence-button"
              onClick={() => setQuickEvidenceOpen(true)}
              disabled={!devices.length || Boolean(working)}
              title={devices.length ? 'Agregar evidencia a cualquier dispositivo' : 'Primero debe registrar al menos un dispositivo'}
            >
              <Icon name="add_a_photo" />Nueva evidencia
            </button>
          )}
          {isAdmin && pick(row, ['SpreadsheetURL']) && <a className="button button--ghost" href={pick(row, ['SpreadsheetURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Excel creado</a>}
          {isAdmin && pick(row, ['SlidesURL']) && <a className="button button--ghost" href={pick(row, ['SlidesURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Presentación creada</a>}
        </section>
      )}

      <div className="maintenance-detail-groups">
        {Object.entries(grouped).map(([category, rows]) => {
          const expanded = expandedCategories.includes(category);
          return (
            <section className={`maintenance-category-section ${expanded ? 'is-expanded' : ''}`} key={category}>
              <button
                type="button"
                className="maintenance-category-section__toggle"
                onClick={() => toggleCategory(category)}
                aria-expanded={expanded}
              >
                <span className="maintenance-category-section__icon"><Icon name={getMaintenanceCategory(category).icon} /></span>
                <span className="maintenance-category-section__title"><span className="eyebrow">Categoría</span><strong>{category}</strong></span>
                <span className="maintenance-category-section__count">{rows.length}</span>
                <Icon name={expanded ? 'expand_less' : 'expand_more'} />
              </button>

              {expanded && (
                <div className="maintenance-detail-device-grid">
                  {rows.map((device) => {
                    let answers = {};
                    try {
                      answers = typeof device.RespuestasJSON === 'string'
                        ? JSON.parse(device.RespuestasJSON || '{}')
                        : device.RespuestasJSON || {};
                    } catch {
                      answers = {};
                    }
                    const config = getMaintenanceCategory(category);
                    const images = device.Imagenes || [];
                    const deviceId = pick(device, ['EvidenciaMantenimientoID', 'id']);

                    return (
                      <article className="maintenance-detail-device" key={deviceId}>
                        <header>
                          <div>
                            <span className="eyebrow">{pick(device, ['Zona'], 'Sin ubicación')}</span>
                            <h3>{pick(device, ['NombreDispositivo'], 'Dispositivo')}</h3>
                            <p>{[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin modelo o serie'}</p>
                          </div>
                          <span className={`maintenance-device-state ${answerClass(pick(device, ['Estado']))}`}>{pick(device, ['Estado'], 'Sin estado')}</span>
                        </header>

                        <div className="maintenance-answer-grid">
                          <div className={answerClass(pick(device, ['Funcionamiento']))}><span>Funcionamiento</span><strong>{pick(device, ['Funcionamiento'], 'Sin responder')}</strong></div>
                          <div className={answerClass(pick(device, ['EnUso']))}><span>En uso</span><strong>{pick(device, ['EnUso'], 'Sin responder')}</strong></div>
                          {config.questions.map(([key, label]) => (
                            <div className={answerClass(answers[key])} key={key}>
                              <span>{label.replace(/^¿|\?$/g, '')}</span><strong>{answers[key] || 'Sin responder'}</strong>
                            </div>
                          ))}
                        </div>

                        {pick(device, ['Observacion']) && <div className="maintenance-observation"><Icon name="notes" /><p>{pick(device, ['Observacion'])}</p></div>}

                        <div className="maintenance-device-evidence-heading">
                          <div><strong>Evidencias</strong><span>{images.length} fotografía{images.length === 1 ? '' : 's'}</span></div>
                          {status === 'PENDIENTE' && canEdit && (
                            <button className="button button--secondary button--compact" type="button" onClick={() => setEvidenceDevice(device)}>
                              <Icon name="add_a_photo" />Agregar evidencias
                            </button>
                          )}
                        </div>

                        <div className="maintenance-detail-images">
                          {images.map((image) => (
                            <figure className="maintenance-evidence-card" key={pick(image, ['FotoDispositivoID', 'id'])}>
                              <MaintenanceEvidenceImage image={image} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
                              <figcaption><strong>{pick(image, ['Tipo'], 'Evidencia')}</strong><span>{pick(image, ['Nota'], 'Sin nota')}</span></figcaption>
                              {status === 'PENDIENTE' && canEdit && (
                                <button
                                  type="button"
                                  className="maintenance-evidence-edit-button"
                                  onClick={() => setEditingEvidence({ image, device })}
                                  aria-label={`Editar evidencia de ${pick(device, ['NombreDispositivo'], 'dispositivo')}`}
                                >
                                  <Icon name="edit" />Editar
                                </button>
                              )}
                            </figure>
                          ))}
                          {!images.length && <div className="muted-copy">Sin fotografías.</div>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {!categoryNames.length && (
          <div className="empty-state"><Icon name="devices_other" /><h2>Sin dispositivos registrados</h2><p>Agregue dispositivos desde la edición del mantenimiento.</p></div>
        )}
      </div>

      <section className="maintenance-detail-footer-actions">
        {status === 'PENDIENTE' && canFinalize && <button className="button button--primary" type="button" onClick={() => action('finalize')} disabled={Boolean(working)}><Icon name="task_alt" />Finalizar mantenimiento</button>}
        {status === 'FINALIZADO' && isAdmin && <button className="button button--secondary" type="button" onClick={() => action('reopen')} disabled={Boolean(working)}><Icon name="undo" />Volver a pendiente</button>}
        {isAdmin && <button className="button button--danger" type="button" onClick={() => action('delete')} disabled={Boolean(working)}><Icon name="delete" />Eliminar</button>}
      </section>

      {evidenceDevice && (
        <MaintenanceEvidenceUploader
          device={evidenceDevice}
          maintenanceId={maintenanceId}
          sessionToken={sessionToken}
          onClose={() => setEvidenceDevice(null)}
          onUploaded={() => load({ silent: true })}
        />
      )}

      {quickEvidenceOpen && (
        <MaintenanceEvidenceUploader
          devices={devices}
          maintenanceId={maintenanceId}
          sessionToken={sessionToken}
          onClose={() => setQuickEvidenceOpen(false)}
          onUploaded={() => load({ silent: true })}
        />
      )}

      {editingEvidence && (
        <MaintenanceEvidenceEditor
          image={editingEvidence.image}
          device={editingEvidence.device}
          maintenanceId={maintenanceId}
          sessionToken={sessionToken}
          isAdmin={isAdmin}
          onClose={() => setEditingEvidence(null)}
          onUpdated={() => load({ silent: true })}
        />
      )}
    </div>
  );
}
