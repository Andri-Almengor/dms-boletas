import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import ImageViewer from '../../components/tickets/ImageViewer';
import MediaPreview from '../../components/tickets/MediaPreview';
import SignaturePad from '../../components/tickets/SignaturePad';
import { TicketStatusChip } from '../../components/tickets/TicketCard';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { formatDate, formatTime, normalizeTicketStatus } from '../../utils/tickets';

const RESEND_CHAT_ROUTES = ['boletas.resendChats', 'tickets.resendChats', 'boletas.reenviarChats'];

function DetailSection({ title, icon, children, open = false }) {
  return (
    <details className="ticket-detail-section" open={open}>
      <summary>
        <span className="section-marker" />
        {icon && <Icon name={icon} />}
        <strong>{title}</strong>
        <Icon name="expand_more" />
      </summary>
      <div className="ticket-detail-section__content">{children}</div>
    </details>
  );
}

function InfoGrid({ items }) {
  return (
    <dl className="ticket-info-grid">
      {items.map(([label, value, wide]) => (
        <div className={wide ? 'is-wide' : ''} key={label}>
          <dt>{label}</dt>
          <dd>{value || 'Sin especificar'}</dd>
        </div>
      ))}
    </dl>
  );
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function cameraEvidenceName() {
  const formatter = new Intl.DateTimeFormat('es-CR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return `Foto ${formatter.format(new Date())}`;
}

export default function TicketDetailPage() {
  const { boletaUid } = useParams();
  const { sessionToken, hasPermission } = useAuth();
  const navigate = useNavigate();
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [processing, setProcessing] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [evidenceForm, setEvidenceForm] = useState({ name: '', note: '', file: null });
  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState('');

  const canEdit = hasPermission('BOLETAS_EDITAR');
  const canEvidence = hasPermission('BOLETAS_EVIDENCIAS') || canEdit;
  const canFinalize = hasPermission('BOLETAS_FINALIZAR');
  const canAdmin = hasPermission('BOLETAS_ELIMINAR') || hasPermission('USUARIOS_GESTIONAR');
  const canTest = hasPermission('NOTIFICACIONES_PRUEBA') && hasPermission('USUARIOS_GESTIONAR');

  async function loadTicket() {
    setLoading(true);
    setError('');
    try {
      const result = await requestAvailable(MODULE_ROUTES.tickets.get, { boletaUid, id: boletaUid }, sessionToken);
      setData(result?.boleta
        ? result
        : { boleta: result, evidencias: result?.Evidencias || [], asignados: result?.asignados || [] });
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTicket();
  }, [boletaUid, sessionToken]);

  const record = data?.boleta || {};

  async function shareTicket(displayId) {
    setNotice('');
    try {
      if (navigator.share) {
        await navigator.share({ title: `Boleta #${displayId}`, url: window.location.href });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(window.location.href);
        setNotice('Enlace de la boleta copiado.');
        return;
      }
      window.prompt('Copia el enlace de la boleta:', window.location.href);
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') setError('No se pudo compartir el enlace de la boleta.');
    }
  }

  async function finalAction(type) {
    const messages = {
      finalize: '¿Finalizar la boleta, generar PDF y enviar las notificaciones?',
      test: '¿Ejecutar una prueba sin cambiar el estado ni notificar al cliente?',
      pending: '¿Regresar esta boleta a pendiente?',
      resend: '¿Generar el reporte actualizado y reenviarlo únicamente al Chat de boletas y al Chat del cliente? No se enviará correo electrónico.',
    };
    if (!window.confirm(messages[type])) return;
    setProcessing(true);
    setError('');
    setNotice('');
    try {
      let result = null;
      if (type === 'finalize') {
        result = await requestAvailable(MODULE_ROUTES.tickets.finalize, {
          boletaUid,
          testMode: false,
          sendClientCopy: Boolean(record.EnviarCorreoCliente),
          cc: record.CorreosCC || '',
        }, sessionToken);
      }
      if (type === 'test') {
        result = await requestAvailable(MODULE_ROUTES.tickets.testFinalize, { boletaUid, testMode: true }, sessionToken);
      }
      if (type === 'pending') {
        result = await requestAvailable(MODULE_ROUTES.tickets.returnPending, { boletaUid, estado: 'PENDIENTE' }, sessionToken);
      }
      if (type === 'resend') {
        result = await requestAvailable(RESEND_CHAT_ROUTES, { boletaUid }, sessionToken);
        setNotice(result?.message || 'Boleta reenviada únicamente a los chats configurados. No se envió correo electrónico.');
      }
      await loadTicket();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  function selectEvidenceFile(file, source = 'file') {
    if (!file) return;
    setError('');
    setEvidenceForm((current) => ({
      ...current,
      file,
      name: current.name || (source === 'camera' ? cameraEvidenceName() : file.name),
    }));
  }

  async function uploadEvidence(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!evidenceForm.file) {
      setError('Tome una foto o seleccione un archivo antes de guardar la evidencia.');
      return;
    }
    setProcessing(true);
    setError('');
    setNotice('');
    try {
      await requestAvailable(MODULE_ROUTES.tickets.evidenceUpload, {
        boletaUid,
        nombre: evidenceForm.name || evidenceForm.file.name,
        nota: evidenceForm.note,
        fileName: evidenceForm.file.name,
        mimeType: evidenceForm.file.type || 'application/octet-stream',
        base64: await fileToBase64(evidenceForm.file),
      }, sessionToken);
      setEvidenceForm({ name: '', note: '', file: null });
      formElement?.reset();
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice('Evidencia agregada correctamente. Si la boleta ya estaba finalizada, use “Reenviar a chats” para publicar el reporte actualizado.');
      await loadTicket();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function saveSignature() {
    if (!signatureDraft?.startsWith('data:image/')) {
      setError('Dibuje o modifique la firma antes de guardarla.');
      return;
    }
    setProcessing(true);
    setError('');
    setNotice('');
    try {
      await requestAvailable(MODULE_ROUTES.tickets.signatureUpload, {
        boletaUid,
        base64: signatureDraft.split(',')[1],
        mimeType: 'image/png',
        fileName: `firma_boleta_${boletaUid}.png`,
      }, sessionToken);
      setSignatureDraft('');
      setSignatureEditorOpen(false);
      setNotice('Firma actualizada correctamente. Si la boleta ya estaba finalizada, use “Reenviar a chats” para publicar el reporte actualizado.');
      await loadTicket();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function editEvidence(item) {
    const nombre = window.prompt('Nombre de la evidencia', pick(item, ['Nombre', 'name'], ''));
    if (nombre === null) return;
    const nota = window.prompt('Nota de la evidencia', pick(item, ['Nota', 'note'], ''));
    if (nota === null) return;
    setProcessing(true);
    setError('');
    setNotice('');
    try {
      await requestAvailable(MODULE_ROUTES.tickets.evidenceUpdate, {
        evidenciaId: pick(item, ['EvidenciaID', 'id']),
        nombre,
        nota,
      }, sessionToken);
      setNotice('Evidencia actualizada. En una boleta finalizada, use “Reenviar a chats” para compartir el nuevo reporte.');
      await loadTicket();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function deleteEvidence(item) {
    if (!window.confirm('¿Eliminar esta evidencia?')) return;
    setProcessing(true);
    setError('');
    setNotice('');
    try {
      await requestAvailable(MODULE_ROUTES.tickets.evidenceDelete, {
        evidenciaId: pick(item, ['EvidenciaID', 'id']),
      }, sessionToken);
      setNotice('Evidencia eliminada. En una boleta finalizada, use “Reenviar a chats” para compartir el nuevo reporte.');
      await loadTicket();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boleta...</span></div></div>;
  }

  if (!data) {
    return (
      <div className="page page--narrow">
        <div className="alert alert--error"><Icon name="error" /><span>{error || 'No se encontró la boleta.'}</span></div>
        <button className="button button--secondary" type="button" onClick={() => navigate('/boletas/pendientes')}><Icon name="arrow_back" /> Volver</button>
      </div>
    );
  }

  const evidences = data?.evidencias || data?.evidences || [];
  const assigned = (data?.asignados || [])
    .map((item) => pick(item, ['NombreCompleto', 'Nombre', 'NombreUsuarioSnapshot', 'NombreUsuario', 'Correo', 'name']))
    .filter(Boolean)
    .join(', ');
  const status = normalizeTicketStatus(record);
  const displayId = pick(record, ['BoletaID', 'TicketID'], boletaUid);
  const pdfUrl = pick(record, ['PDFURL', 'PDFUrl', 'PDF_Url', 'pdfUrl']);
  const documentUrl = pick(record, ['DocumentoURL', 'DocumentoUrl', 'documentUrl']);
  const folderUrl = pick(record, ['CarpetaURL', 'CarpetaUrl', 'folderUrl']);
  const signatureFileId = pick(record, ['FirmaFileID', 'FirmaArchivoID']);
  const signatureUrl = pick(record, ['FirmaURL', 'FirmaUrl', 'Firma', 'signature']);
  const deviceName = pick(record, ['Descripcion', 'Descripción', 'DescripcionEquipo', 'NombreEquipo']);
  const backTo = status === 'FINALIZADA' ? '/boletas/finalizadas' : '/boletas/pendientes';
  const finalized = status === 'FINALIZADA';
  const canResend = finalized && (canEdit || canFinalize || canAdmin);

  return (
    <div className="page page--narrow ticket-detail-page">
      <div className="page-header ticket-detail-header">
        <button className="icon-button" type="button" onClick={() => navigate(backTo)} aria-label="Volver"><Icon name="arrow_back" /></button>
        <div><span className="eyebrow">Detalle de servicio</span><h1>Boleta #{String(displayId).slice(0, 20)}</h1></div>
        <button className="icon-button" type="button" onClick={() => shareTicket(displayId)} aria-label="Compartir"><Icon name="share" /></button>
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
      {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}
      {finalized && canEdit && (
        <div className="info-box">
          <Icon name="edit_note" />
          <p>Esta boleta está finalizada, pero puede corregir sus datos, firma y evidencias. Los cambios no envían correos. Después use <strong>Reenviar a chats</strong> para generar el PDF actualizado y publicarlo en los chats.</p>
        </div>
      )}

      <section className="ticket-status-card">
        <div><span>Estado actual</span><TicketStatusChip status={status} /></div>
        <div><span>Fecha de asignación</span><strong>{formatDate(pick(record, ['Fecha', 'FechaCreacion']))}</strong></div>
      </section>

      <DetailSection title="Información General" icon="description" open>
        <InfoGrid items={[
          ['Título', pick(record, ['Titulo', 'Título']), true],
          ['Categoría', pick(record, ['Categoria', 'Categoría'])],
          ['Tipo de falla', pick(record, ['TipoFalla'])],
          ['Fecha', formatDate(pick(record, ['Fecha']))],
          ['Hora inicio', formatTime(pick(record, ['HoraInicio']))],
          ['Hora final', formatTime(pick(record, ['HoraFinal']))],
          ['Horas totales', pick(record, ['HorasTotales'], '0.00')],
        ]} />
      </DetailSection>

      <DetailSection title="Cliente" icon="corporate_fare">
        <InfoGrid items={[
          ['Cliente', pick(record, ['Cliente', 'ClienteNombre']), true],
          ['Ubicación', pick(record, ['Ubicacion', 'Ubicación'])],
          ['Ubicación del equipo', pick(record, ['UbicacionEquipo', 'Ubicacion_equipo'])],
          ['Supervisor', pick(record, ['Supervisor'])],
          ['Correo supervisor', pick(record, ['CorreoSupervisor'])],
          ['Correo cliente', pick(record, ['CorreoCliente', 'Correo_Cliente'])],
        ]} />
      </DetailSection>

      <DetailSection title="Dispositivo / Equipo" icon="devices_other">
        <InfoGrid items={[
          ['Nombre del dispositivo', deviceName, true],
          ['Tipo', pick(record, ['TipoDispositivo'])],
          ['Fabricante', pick(record, ['Fabricante'])],
          ['Modelo', pick(record, ['Modelo'])],
          ['Serie', pick(record, ['Serie'])],
        ]} />
      </DetailSection>

      <DetailSection title="Trabajo Realizado" icon="engineering">
        <InfoGrid items={[
          ['Razón de visita', pick(record, ['RazonVisita', 'Razon_visita']), true],
          ['Pruebas realizadas', pick(record, ['PruebasRealizadas', 'Pruebas realizadas']), true],
          ['Resultado', pick(record, ['Resultado']), true],
          ['Recomendaciones', pick(record, ['Recomendaciones']), true],
          ['Técnicos asignados', assigned, true],
        ]} />
      </DetailSection>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">Archivos</span><h2>Evidencias Fotográficas</h2></div></div>
        {evidences.length ? (
          <div className="evidence-gallery">
            {evidences.map((item, index) => {
              const evidenceId = pick(item, ['EvidenciaID', 'id']);
              const fileId = pick(item, ['ArchivoFileID', 'ArchivoID', 'fileId']);
              const url = pick(item, ['ArchivoURL', 'URL', 'url']);
              const mimeType = pick(item, ['MimeType', 'mimeType']);
              const name = pick(item, ['Nombre', 'name'], `Evidencia ${index + 1}`);
              const note = pick(item, ['Nota', 'note']);
              return (
                <article className="evidence-detail-card" key={evidenceId || index}>
                  <MediaPreview boletaUid={boletaUid} evidenceId={evidenceId} fileId={fileId} directUrl={url} mimeType={mimeType} alt={name} onOpen={(source) => setViewer({ source, alt: name })} />
                  <div><strong>{name}</strong>{note && <p>{note}</p>}</div>
                  {canEvidence && <div className="evidence-detail-card__actions">
                    <button type="button" onClick={() => editEvidence(item)} disabled={processing} aria-label={`Editar ${name}`}><Icon name="edit" /></button>
                    <button type="button" onClick={() => deleteEvidence(item)} disabled={processing} aria-label={`Eliminar ${name}`}><Icon name="delete" /></button>
                  </div>}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><Icon name="photo_library" /><h2>Sin evidencias</h2><p>No hay archivos asociados a esta boleta.</p></div>
        )}

        {canEvidence && (
          <form className="evidence-inline-form ticket-detail-evidence-form" onSubmit={uploadEvidence}>
            <div className="ticket-detail-capture-actions">
              <input
                ref={cameraInputRef}
                className="ticket-detail-hidden-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => selectEvidenceFile(event.target.files?.[0], 'camera')}
              />
              <button className="button button--primary" type="button" onClick={() => cameraInputRef.current?.click()} disabled={processing}>
                <Icon name="photo_camera" /> Tomar foto
              </button>
              <button className="button button--secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={processing}>
                <Icon name="upload_file" /> Seleccionar archivo
              </button>
              <input
                ref={fileInputRef}
                className="ticket-detail-hidden-input"
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                onChange={(event) => selectEvidenceFile(event.target.files?.[0], 'file')}
              />
            </div>
            {evidenceForm.file && <div className="ticket-detail-selected-file"><Icon name="check_circle" /><span>{evidenceForm.file.name}</span></div>}
            <input className="form-control" value={evidenceForm.name} onChange={(event) => setEvidenceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre de la evidencia" />
            <input className="form-control" value={evidenceForm.note} onChange={(event) => setEvidenceForm((current) => ({ ...current, note: event.target.value }))} placeholder="Nota opcional" />
            <button className="button button--primary" disabled={processing || !evidenceForm.file}><Icon name="add_a_photo" /> {processing ? 'Guardando...' : 'Añadir evidencia'}</button>
          </form>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading ticket-signature-heading">
          <div><span className="eyebrow">Conformidad</span><h2>Firma del Cliente</h2></div>
          {canEdit && !signatureEditorOpen && (
            <button className="button button--secondary button--compact" type="button" onClick={() => { setSignatureDraft(''); setSignatureEditorOpen(true); }}>
              <Icon name="draw" /> {signatureFileId || signatureUrl ? 'Editar firma' : 'Agregar firma'}
            </button>
          )}
        </div>
        {signatureEditorOpen ? (
          <div className="ticket-signature-editor">
            <SignaturePad value={signatureDraft} onChange={setSignatureDraft} />
            <div className="ticket-signature-editor__actions">
              <button className="button button--secondary" type="button" disabled={processing} onClick={() => { setSignatureDraft(''); setSignatureEditorOpen(false); }}><Icon name="close" /> Cancelar</button>
              <button className="button button--primary" type="button" disabled={processing || !signatureDraft} onClick={saveSignature}><Icon name="save" /> {processing ? 'Guardando...' : 'Guardar firma'}</button>
            </div>
          </div>
        ) : (
          <div className="signature-display">
            {signatureFileId || signatureUrl
              ? <MediaPreview boletaUid={boletaUid} fileId={signatureFileId} kind="signature" directUrl={signatureUrl} mimeType="image/png" alt="Firma del cliente" onOpen={(source) => setViewer({ source, alt: 'Firma del cliente' })} />
              : <span><Icon name="draw" /> Firma pendiente</span>}
          </div>
        )}
      </section>

      <section className="document-links">
        <h2>Documentos</h2>
        <div>
          {documentUrl && <a className="button button--secondary" href={documentUrl} target="_blank" rel="noreferrer"><Icon name="description" /> Google Doc</a>}
          {pdfUrl && <a className="button button--secondary" href={pdfUrl} target="_blank" rel="noreferrer"><Icon name="picture_as_pdf" /> PDF</a>}
          {folderUrl && <a className="button button--secondary" href={folderUrl} target="_blank" rel="noreferrer"><Icon name="folder" /> Carpeta Drive</a>}
        </div>
      </section>

      <div className="ticket-detail-actions">
        {canEdit && <Link className="button button--secondary" to={`/boletas/${encodeURIComponent(boletaUid)}/editar`}><Icon name="edit" /> Editar</Link>}
        {canTest && !finalized && <button className="button button--secondary" type="button" onClick={() => finalAction('test')} disabled={processing}><Icon name="science" /> Probar</button>}
        {finalized
          ? <>
            {pdfUrl && <a className="button button--secondary" href={pdfUrl} target="_blank" rel="noreferrer"><Icon name="picture_as_pdf" /> Abrir PDF</a>}
            {canResend && <button className="button button--primary button--wide" type="button" onClick={() => finalAction('resend')} disabled={processing}><Icon name="send" /> {processing ? 'Reenviando...' : 'Reenviar a chats'}</button>}
            {canAdmin && <button className="button button--secondary" type="button" onClick={() => finalAction('pending')} disabled={processing}><Icon name="undo" /> Volver a pendiente</button>}
          </>
          : canFinalize && <button className="button button--primary button--wide" type="button" onClick={() => finalAction('finalize')} disabled={processing}><Icon name="task_alt" /> {processing ? 'Procesando...' : 'Finalizar boleta'}</button>}
      </div>

      <ImageViewer open={Boolean(viewer)} source={viewer?.source} alt={viewer?.alt} onClose={() => setViewer(null)} />
    </div>
  );
}
