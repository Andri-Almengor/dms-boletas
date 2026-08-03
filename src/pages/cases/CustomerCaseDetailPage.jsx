import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import CustomerCaseProcessingOverlay from '../../components/cases/CustomerCaseProcessingOverlay';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import {
  CUSTOMER_CASE_ROUTES,
  customerCaseStateLabel,
  customerCaseView,
  requestCustomerCase,
} from '../../services/customerCases';
import '../../styles/customer-cases.css';
import '../../styles/customer-cases-polish.css';
import '../../styles/customer-cases-evidence-status.css';
import '../../styles/customer-cases-workflow.css';

function technicianView(record = {}) {
  return {
    id: String(pick(record, ['UsuarioID', 'id'])),
    name: String(pick(record, ['NombreCompleto', 'Nombre', 'NombreUsuario'], 'Técnico')),
    email: String(pick(record, ['Correo', 'email'])),
  };
}

function EvidenceCard({ evidence, caseId, sessionToken }) {
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadPreview() {
    if (preview || loading) return;
    setLoading(true);
    setError('');
    try {
      const file = await requestCustomerCase(CUSTOMER_CASE_ROUTES.mediaGet, {
        caseId,
        evidenceId: evidence.CasoEvidenciaID,
      }, sessionToken);
      setPreview(file.dataUrl || file.url || '');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo abrir la evidencia.');
    } finally {
      setLoading(false);
    }
  }

  return <article className="case-evidence-card">
    <div className="case-evidence-card__preview">
      {preview ? <img src={preview} alt={evidence.NombreArchivo || 'Evidencia del caso'} /> : <button type="button" onClick={loadPreview}><Icon name={loading ? 'progress_activity' : 'image'} /><span>{loading ? 'Cargando...' : 'Ver imagen'}</span></button>}
    </div>
    <div><strong>{evidence.NombreArchivo || 'Evidencia'}</strong>{evidence.Nota && <span>{evidence.Nota}</span>}{error && <small className="is-error">{error}</small>}{evidence.DriveURL && <a href={evidence.DriveURL} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Abrir en Drive</a>}</div>
  </article>;
}

function dateDisplay(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: String(value).includes('T') ? 'short' : undefined }).format(date);
}

export default function CustomerCaseDetailPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const { sessionToken } = useAuth();
  const [bundle, setBundle] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [selectedTechnicians, setSelectedTechnicians] = useState([]);
  const [technicianSearch, setTechnicianSearch] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [visitTime, setVisitTime] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [caseBundle, userResponse] = await Promise.all([
        requestCustomerCase(CUSTOMER_CASE_ROUTES.get, { caseId }, sessionToken),
        requestAvailable(MODULE_ROUTES.users.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
      ]);
      const item = customerCaseView(caseBundle.case || {});
      setBundle({ ...caseBundle, case: item });
      setTechnicians(normalizeItems(userResponse).map(technicianView).filter((user) => user.id));
      setSelectedTechnicians(item.technicianIds || []);
      setVisitDate(item.visitDate || '');
      setVisitTime(item.visitTime || '');
      setAdminMessage(item.adminMessage || '');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el caso.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [caseId, sessionToken]);

  const item = bundle?.case;
  const selectedNames = useMemo(() => technicians.filter((user) => selectedTechnicians.includes(user.id)).map((user) => user.name), [selectedTechnicians, technicians]);
  const filteredTechnicians = useMemo(() => {
    const query = technicianSearch.trim().toLowerCase();
    if (!query) return technicians;
    return technicians.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query));
  }, [technicianSearch, technicians]);
  const canProcess = item && item.state !== 'FINALIZADO';
  const evidenceRows = bundle?.evidences || [];
  const requestedEvidenceCount = Math.max(Number(item?.requestedEvidenceCount || 0), evidenceRows.length);
  const failedEvidenceCount = Math.max(Number(item?.failedEvidenceCount || 0), Math.max(0, requestedEvidenceCount - evidenceRows.length));

  function toggleTechnician(id) {
    setSelectedTechnicians((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function processCase(event) {
    event.preventDefault();
    if (!selectedTechnicians.length) {
      setError('Seleccione al menos un técnico.');
      return;
    }
    if (!visitDate) {
      setError('Seleccione la fecha de la visita.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await requestCustomerCase(CUSTOMER_CASE_ROUTES.process, {
        caseId,
        technicianIds: selectedTechnicians,
        visitDate,
        visitTime,
        adminMessage,
      }, sessionToken);
      const updated = customerCaseView(response.case || {});
      setBundle({ ...response, case: updated });
      setSelectedTechnicians(updated.technicianIds || selectedTechnicians);
      const ticketLabel = updated.ticketNumber || updated.ticketId;
      if (updated.testMode) {
        setNotice(response.notificationSent
          ? `La prueba pasó a proceso, se creó la boleta ${ticketLabel} sin usar el consecutivo real y se notificó a los técnicos seleccionados.`
          : `La prueba pasó a proceso y se creó la boleta ${ticketLabel}. El correo a técnicos quedó con una advertencia: ${response.notificationWarning || 'revise Apps Script'}`);
      } else {
        setNotice(response.notificationSent
          ? `El caso pasó a proceso, se creó la boleta #${ticketLabel} y se notificó a los técnicos.`
          : `El caso pasó a proceso y se creó la boleta #${ticketLabel}. El correo quedó registrado con una advertencia: ${response.notificationWarning || 'revise Apps Script'}`);
      }
    } catch (saveError) {
      setError(saveError.message || 'No se pudo pasar el caso a proceso.');
    } finally {
      setSaving(false);
    }
  }

  async function resend() {
    if (!item?.id || resending) return;
    setResending(true);
    setError('');
    setNotice('');
    try {
      const response = await requestCustomerCase(CUSTOMER_CASE_ROUTES.resendTechnicians, { caseId: item.id }, sessionToken);
      setNotice(response.sent ? 'El correo fue reenviado a los técnicos seleccionados.' : `El reenvío no se completó: ${response.warning || 'revise Apps Script'}`);
    } catch (sendError) {
      setError(sendError.message || 'No se pudo reenviar el correo.');
    } finally {
      setResending(false);
    }
  }

  if (loading) return <><div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando caso...</div></div><CustomerCaseProcessingOverlay open title="Preparando el caso" message="Estamos cargando la solicitud, sus evidencias y los técnicos disponibles." steps={['Consultando la solicitud', 'Cargando evidencias', 'Preparando el detalle']} /></>;
  if (!item) return <div className="page"><div className="state-card state-card--error"><Icon name="error" /><h1>No se encontró el caso</h1><p>{error}</p><button className="button button--secondary" onClick={() => navigate('/casos')}>Volver</button></div></div>;

  const processSteps = item.testMode
    ? ['Validando la asignación', 'Creando boleta de prueba', 'Asignando técnicos', 'Redactando correo con Gemini', 'Enviando correo a los técnicos']
    : ['Validando la asignación', 'Creando o actualizando la boleta', 'Asignando técnicos', 'Redactando correo con Gemini', 'Enviando correo a los técnicos'];

  return <div className="page customer-case-detail-page">
    <CustomerCaseProcessingOverlay open={saving} testMode={item.testMode} title={item.testMode ? 'Preparando la prueba' : 'Pasando el caso a proceso'} message={item.testMode ? 'La boleta de prueba no consumirá el consecutivo real. Los técnicos seleccionados sí recibirán el correo.' : 'Estamos creando la boleta, guardando la asignación y notificando a los técnicos.'} steps={processSteps} />

    <header className="case-detail-heading">
      <button type="button" className="icon-button icon-button--outlined" onClick={() => navigate('/casos')} aria-label="Volver a casos"><Icon name="arrow_back" /></button>
      <div><span className="eyebrow">{item.number}</span>{item.testMode && <span className="case-detail-heading__test"><Icon name="science" />Modo prueba</span>}<h1>{item.reason || 'Caso de cliente'}</h1><p>{item.client}</p></div>
      <span className={`case-status-pill ${item.state === 'FINALIZADO' ? 'is-finished' : item.state === 'EN_PROCESO' ? 'is-process' : 'is-waiting'}`}><Icon name={item.state === 'FINALIZADO' ? 'task_alt' : item.state === 'EN_PROCESO' ? 'engineering' : 'schedule'} />{customerCaseStateLabel(item.state)}</span>
    </header>

    {item.testMode && <section className="case-test-detail-banner"><Icon name="science" /><div><strong>Este es un caso de prueba</strong><span>El correo inicial utiliza los destinatarios configurados para pruebas. La boleta tendrá numeración PRUEBA y no consumirá el consecutivo real. Los técnicos que seleccione sí recibirán la asignación.</span></div></section>}
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}

    <div className="case-detail-layout">
      <div className="case-detail-main">
        <section className="case-detail-section"><header><span><Icon name="description" /></span><div><h2>Solicitud del cliente</h2><p>Información original enviada desde el formulario.</p></div></header><div className="case-detail-data-grid"><div><span>Cliente</span><strong>{item.client}</strong></div><div><span>Fecha de creación</span><strong>{dateDisplay(item.createdAt)}</strong></div><div><span>Generado por</span><strong>{item.requesterName}</strong></div><div><span>Correo</span><a href={`mailto:${item.requesterEmail}`}>{item.requesterEmail}</a></div><div className="is-wide"><span>Razón de la visita</span><strong>{item.reason}</strong></div><div className="is-wide"><span>Problema reportado</span><p>{item.problem}</p></div></div></section>

        <section className="case-detail-section"><header><span><Icon name="photo_library" /></span><div><h2>Evidencias ({evidenceRows.length}{requestedEvidenceCount > evidenceRows.length ? ` de ${requestedEvidenceCount}` : ''})</h2><p>Imágenes aportadas por el cliente.</p></div></header>
          {failedEvidenceCount > 0 && <div className="case-evidence-admin-warning"><Icon name="warning" /><div><strong>La carga de evidencias quedó incompleta</strong><span>{failedEvidenceCount === 1 ? 'No se pudo almacenar 1 archivo.' : `No se pudieron almacenar ${failedEvidenceCount} archivos.`} {item.evidenceError || 'El caso sí fue creado y puede continuar su gestión.'}</span></div></div>}
          {evidenceRows.length ? <div className="case-evidence-detail-grid">{evidenceRows.map((evidence) => <EvidenceCard key={evidence.CasoEvidenciaID} evidence={evidence} caseId={item.id} sessionToken={sessionToken} />)}</div> : <div className="case-section-empty"><Icon name="hide_image" /><span>{requestedEvidenceCount ? 'Las evidencias seleccionadas no lograron cargarse.' : 'El cliente no adjuntó evidencias.'}</span></div>}
        </section>
      </div>

      <aside className="case-detail-sidebar">
        {canProcess ? <form className="case-assignment-panel" onSubmit={processCase}>
          <header><span><Icon name={item.testMode ? 'science' : 'assignment_ind'} /></span><div><h2>{item.state === 'EN_PROCESO' ? 'Actualizar asignación' : item.testMode ? 'Preparar prueba' : 'Preparar visita'}</h2><p>{item.testMode ? 'Se creará una boleta PRUEBA sin modificar el consecutivo real.' : 'La boleta se crea al pasar el caso a proceso.'}</p></div></header>
          <fieldset><legend>Técnicos asignados *</legend><div className="case-technician-search"><Icon name="search" /><input type="search" value={technicianSearch} onChange={(event) => setTechnicianSearch(event.target.value)} placeholder="Buscar técnico por nombre o correo..." aria-label="Buscar técnicos" />{technicianSearch && <button type="button" onClick={() => setTechnicianSearch('')} aria-label="Limpiar búsqueda"><Icon name="close" /></button>}</div><p className="case-technician-count"><span>{filteredTechnicians.length} técnico{filteredTechnicians.length === 1 ? '' : 's'} visible{filteredTechnicians.length === 1 ? '' : 's'}</span><strong>{selectedTechnicians.length} seleccionado{selectedTechnicians.length === 1 ? '' : 's'}</strong></p><div className="case-technician-options">{filteredTechnicians.length ? filteredTechnicians.map((user) => <label key={user.id} className={selectedTechnicians.includes(user.id) ? 'is-selected' : ''}><input type="checkbox" checked={selectedTechnicians.includes(user.id)} onChange={() => toggleTechnician(user.id)} /><span><strong>{user.name}</strong><small>{user.email || 'Sin correo'}</small></span><Icon name={selectedTechnicians.includes(user.id) ? 'check_circle' : 'radio_button_unchecked'} /></label>) : <div className="case-technician-empty"><Icon name="person_search" /><span>No hay técnicos que coincidan con la búsqueda.</span></div>}</div></fieldset>
          <div className="case-assignment-date-grid"><label><span>Fecha de visita *</span><input type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} /></label><label><span>Hora</span><input type="time" value={visitTime} onChange={(event) => setVisitTime(event.target.value)} /></label></div>
          <label className="case-field"><span>Mensaje adicional para los técnicos</span><textarea rows="5" value={adminMessage} onChange={(event) => setAdminMessage(event.target.value)} maxLength="4000" placeholder="Indicaciones de acceso, contacto, prioridad operativa u otra información útil." /></label>
          {selectedNames.length > 0 && <p className="case-selected-summary"><Icon name="engineering" /><span><strong>Asignados:</strong> {selectedNames.join(', ')}</span></p>}
          <button className="button button--primary" disabled={saving}><Icon name={saving ? 'progress_activity' : item.state === 'EN_PROCESO' ? 'save' : item.testMode ? 'science' : 'play_circle'} />{saving ? item.testMode ? 'Creando prueba y notificando...' : 'Creando boleta y notificando...' : item.state === 'EN_PROCESO' ? item.testMode ? 'Actualizar prueba y notificar' : 'Actualizar y notificar' : item.testMode ? 'Crear boleta de prueba' : 'Pasar a en proceso'}</button>
        </form> : <section className="case-finished-panel"><Icon name="task_alt" /><h2>{item.testMode ? 'Prueba finalizada' : 'Caso finalizado'}</h2><p>{item.testMode ? 'La boleta de prueba se cerró sin enviar correo al cliente ni Google Chat.' : 'La boleta vinculada fue finalizada y el caso cambió de estado automáticamente.'}</p><span>{dateDisplay(item.finalizedAt)}</span></section>}

        {item.ticketId && <section className="case-ticket-panel"><header><Icon name={item.testMode ? 'science' : 'confirmation_number'} /><div><strong>{item.testMode ? 'Boleta de prueba ' : 'Boleta #'}{item.ticketNumber || item.ticketId}</strong><span>{item.testMode ? 'No usa el consecutivo real' : 'Creada desde este caso'}</span></div></header><Link className="button button--secondary" to={`/boletas/${encodeURIComponent(item.ticketId)}`}><Icon name="open_in_new" />Abrir boleta</Link>{item.state === 'EN_PROCESO' && <button className="button button--ghost" type="button" onClick={resend} disabled={resending}><Icon name={resending ? 'progress_activity' : 'forward_to_inbox'} />{resending ? 'Reenviando...' : 'Reenviar correo a técnicos'}</button>}</section>}

        <section className="case-notification-panel"><h3>Notificaciones</h3><div><span>{item.testMode ? 'Al crear (modo prueba)' : 'Al crear'}</span><strong className={String(item.EstadoNotificacionInicial).toUpperCase() === 'ENVIADO' ? 'is-success' : 'is-warning'}>{item.EstadoNotificacionInicial || 'PENDIENTE'}</strong></div><div><span>A técnicos</span><strong className={String(item.EstadoNotificacionTecnicos).toUpperCase() === 'ENVIADO' ? 'is-success' : 'is-warning'}>{item.EstadoNotificacionTecnicos || 'PENDIENTE'}</strong></div><div><span>Evidencias</span><strong className={failedEvidenceCount ? 'is-warning' : 'is-success'}>{failedEvidenceCount ? `${evidenceRows.length}/${requestedEvidenceCount || evidenceRows.length}` : evidenceRows.length}</strong></div>{item.UltimoErrorNotificacion && <p>{item.UltimoErrorNotificacion}</p>}</section>
      </aside>
    </div>
  </div>;
}
