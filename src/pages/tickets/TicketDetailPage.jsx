import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import ImageViewer from '../../components/tickets/ImageViewer';
import MediaPreview from '../../components/tickets/MediaPreview';
import SignaturePad from '../../components/tickets/SignaturePad';
import { TicketStatusChip } from '../../components/tickets/TicketCard';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import {
  requestSynchronizedDetail,
  subscribeSyncEntity,
} from '../../services/syncManager';
import { uploadTicketEvidenceItems } from '../../services/ticketEvidenceBatch';
import { evidenceMediaKind, prepareEvidenceFiles } from '../../utils/evidenceMedia';
import { normalizeMacAddress } from '../../utils/macAddress';
import { formatDate, formatTime, normalizeTicketStatus } from '../../utils/tickets';

const RESEND_CHAT_ROUTES = ['boletas.resendChats', 'tickets.resendChats', 'boletas.reenviarChats'];
const EMPTY_EVIDENCE = Object.freeze({
  name: '', note: '', file: null, mimeType: '', mediaType: '', durationSeconds: 0, size: 0,
});

function DetailSection({ title, icon, children, open = false }) {
  return (
    <details className="ticket-detail-section" open={open}>
      <summary><span className="section-marker" />{icon && <Icon name={icon} />}<strong>{title}</strong><Icon name="expand_more" /></summary>
      <div className="ticket-detail-section__content">{children}</div>
    </details>
  );
}

function InfoGrid({ items }) {
  return (
    <dl className="ticket-info-grid">
      {items.map(([label, value, wide]) => <div className={wide ? 'is-wide' : ''} key={label}><dt>{label}</dt><dd>{value || 'Sin especificar'}</dd></div>)}
    </dl>
  );
}

function cameraEvidenceName(mediaType = 'image') {
  const formatter = new Intl.DateTimeFormat('es-CR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return `${mediaType === 'video' ? 'Video' : 'Foto'} ${formatter.format(new Date())}`;
}

function evidenceIdentity(item = {}) {
  return String(pick(item, ['EvidenciaID', 'id'], '') || '').trim();
}

function authoritativeEvidence(result) {
  return result?.evidence || result?.evidencia || result || null;
}

function normalizeDetailResult(result) {
  if (!result) return null;
  return result?.boleta
    ? result
    : { boleta: result, evidencias: result?.Evidencias || [], asignados: result?.asignados || [] };
}

function ticketImageViewerItem(item = {}, index = 0) {
  const evidenceId = pick(item, ['EvidenciaID', 'id']);
  const fileId = pick(item, ['ArchivoFileID', 'ArchivoID', 'fileId']);
  const directUrl = pick(item, ['ArchivoURL', 'URL', 'url']);
  const mimeType = pick(item, ['MimeType', 'mimeType']);
  const mediaKind = pick(item, ['TipoMedio', 'MediaType', 'mediaType']);
  const alt = pick(item, ['Nombre', 'name'], `Evidencia ${index + 1}`);
  const normalizedKind = String(mediaKind || '').toLowerCase();
  const resolvedKind = normalizedKind.includes('video')
    ? 'video'
    : (normalizedKind.includes('imagen') || normalizedKind.includes('image'))
      ? 'image'
      : evidenceMediaKind({ mimeType, name: alt });
  if (resolvedKind !== 'image') return null;
  return {
    key: String(evidenceId || fileId || index),
    evidenceId,
    fileId,
    directUrl,
    mimeType,
    mediaKind,
    alt,
    kind: 'evidence',
  };
}

export default function TicketDetailPage() {
  const { boletaUid } = useParams();
  const { sessionToken, user, permissions, hasPermission, securityRevision } = useAuth();
  const navigate = useNavigate();
  const cameraInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadSequenceRef = useRef(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [processing, setProcessing] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [evidenceForm, setEvidenceForm] = useState({ ...EMPTY_EVIDENCE });
  const [evidenceInputVersion, setEvidenceInputVersion] = useState(0);
  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState('');

  const canEdit = hasPermission('BOLETAS_EDITAR');
  const canEvidence = hasPermission('BOLETAS_EVIDENCIAS') || canEdit;
  const canFinalize = hasPermission('BOLETAS_FINALIZAR');
  const canAdmin = hasPermission('BOLETAS_ELIMINAR') || hasPermission('USUARIOS_GESTIONAR');
  const canTest = hasPermission('NOTIFICACIONES_PRUEBA') && hasPermission('USUARIOS_GESTIONAR');

  function patchEvidence(result) {
    const evidence = authoritativeEvidence(result);
    const id = evidenceIdentity(evidence);
    if (!evidence || !id) return;
    setData((current) => {
      if (!current) return current;
      const list = current.evidencias || current.evidences || [];
      const index = list.findIndex((item) => evidenceIdentity(item) === id);
      const next = index >= 0
        ? list.map((item, itemIndex) => itemIndex === index ? { ...item, ...evidence } : item)
        : [...list, evidence];
      return { ...current, evidencias: next, evidences: next };
    });
  }

  function removeEvidence(id) {
    const target = String(id || '').trim();
    if (!target) return;
    setData((current) => {
      if (!current) return current;
      const list = current.evidencias || current.evidences || [];
      const next = list.filter((item) => evidenceIdentity(item) !== target);
      return { ...current, evidencias: next, evidences: next };
    });
  }

  async function loadTicket({ signal, forceSync = false, showLoading = true } = {}) {
    const sequence = ++loadSequenceRef.current;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const result = await requestSynchronizedDetail(
        MODULE_ROUTES.tickets.get,
        { boletaUid, id: boletaUid },
        sessionToken,
        {
          resource: 'ticket',
          entityId: boletaUid,
          userId: user?.UsuarioID,
          permissions,
          signal,
          forceSync,
        },
      );
      if (signal?.aborted || sequence !== loadSequenceRef.current) return;
      setData(normalizeDetailResult(result));
    } catch (err) {
      if (signal?.aborted || sequence !== loadSequenceRef.current || err?.name === 'AbortError') return;
      setError(err.message);
      setData(null);
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadTicket({ signal: controller.signal });
    return () => {
      controller.abort();
      loadSequenceRef.current += 1;
    };
  }, [boletaUid, sessionToken, user?.UsuarioID, permissions, securityRevision]);

  useEffect(() => subscribeSyncEntity('ticket', boletaUid, ({ type, data: incoming }) => {
    if (type === 'security-invalidated') {
      setData(null);
      setError('La seguridad de la sesión cambió. Validando nuevamente sus permisos...');
      setLoading(true);
      return;
    }
    if (type === 'removed') {
      setData(null);
      setLoading(false);
      setError('Esta boleta ya no está disponible para su usuario.');
      return;
    }
    if ((type === 'detail' || type === 'snapshot') && incoming) {
      setData(normalizeDetailResult(incoming));
      setLoading(false);
      setError('');
    }
  }), [boletaUid]);

  useEffect(() => {
    function onEvidenceUploaded(event) {
      if (String(event.detail?.boletaUid || '') !== String(boletaUid || '')) return;
      patchEvidence(event.detail?.evidence);
    }
    window.addEventListener('dms-ticket-evidence-uploaded', onEvidenceUploaded);
    return () => window.removeEventListener('dms-ticket-evidence-uploaded', onEvidenceUploaded);
  }, [boletaUid]);

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
      if (type === 'finalize') result = await requestAvailable(MODULE_ROUTES.tickets.finalize, { boletaUid, testMode: false, sendClientCopy: Boolean(record.EnviarCorreoCliente), cc: record.CorreosCC || '' }, sessionToken);
      if (type === 'test') result = await requestAvailable(MODULE_ROUTES.tickets.testFinalize, { boletaUid, testMode: true }, sessionToken);
      if (type === 'pending') result = await requestAvailable(MODULE_ROUTES.tickets.returnPending, { boletaUid, estado: 'PENDIENTE' }, sessionToken);
      if (type === 'resend') {
        result = await requestAvailable(RESEND_CHAT_ROUTES, { boletaUid }, sessionToken);
        setNotice(result?.message || 'Boleta reenviada únicamente a los chats configurados. No se envió correo electrónico.');
      }
      await loadTicket({ forceSync: true, showLoading: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function selectEvidenceFile(file, source = 'file') {
    if (!file) return;
    setError('');
    try {
      const [prepared] = await prepareEvidenceFiles([file], { allowDocuments: true });
      setEvidenceForm((current) => ({
        ...current,
        file,
        mimeType: prepared.mimeType,
        mediaType: prepared.mediaType,
        durationSeconds: prepared.durationSeconds,
        size: prepared.size,
        name: current.name || (source === 'camera' ? cameraEvidenceName(prepared.mediaType) : file.name),
      }));
    } catch (selectionError) {
      clearEvidenceForm();
      setError(selectionError.message || 'No se pudo preparar la evidencia seleccionada.');
    }
  }

  function clearEvidenceForm() {
    setEvidenceForm({ ...EMPTY_EVIDENCE });
    setEvidenceInputVersion((current) => current + 1);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function uploadEvidence(event) {
    event.preventDefault();
    if (!evidenceForm.file) {
      setError('Tome una foto, grabe un video o seleccione un archivo antes de guardar la evidencia.');
      return;
    }
    setProcessing(true);
    setError('');
    setNotice('');
    try {
      const uploadItem = {
        ...evidenceForm,
        name: evidenceForm.name || evidenceForm.file.name,
        note: evidenceForm.note,
      };
      const uploadResult = await uploadTicketEvidenceItems({
        boletaUid,
        items: [uploadItem],
        sessionToken,
        onUploaded: (row) => patchEvidence(row),
      });
      if (uploadResult.failed?.length) {
        throw new Error(uploadResult.failed[0]?.message || 'No se pudo cargar la evidencia.');
      }
      clearEvidenceForm();
      setNotice('Evidencia agregada correctamente. Si la boleta ya estaba finalizada, use “Reenviar a chats” para publicar el reporte actualizado.');
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
      const result = await requestAvailable(MODULE_ROUTES.tickets.signatureUpload, { boletaUid, base64: signatureDraft.split(',')[1], mimeType: 'image/png', fileName: `firma_boleta_${boletaUid}.png` }, sessionToken);
      const fileId = pick(result, ['id', 'fileId', 'ArchivoID', 'FirmaArchivoID']);
      const signatureUrl = pick(result, ['webViewLink', 'url', 'FirmaURL']);
      if (fileId || signatureUrl) {
        setData((current) => current ? {
          ...current,
          boleta: {
            ...current.boleta,
            ...(fileId ? { FirmaArchivoID: fileId, FirmaFileID: fileId } : {}),
            ...(signatureUrl ? { FirmaURL: signatureUrl } : {}),
            FirmaMimeType: 'image/png',
          },
        } : current);
      }
      setSignatureDraft('');
      setSignatureEditorOpen(false);
      setNotice('Firma actualizada correctamente. Si la boleta ya estaba finalizada, use “Reenviar a chats” para publicar el reporte actualizado.');
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
    try {
      const result = await requestAvailable(MODULE_ROUTES.tickets.evidenceUpdate, { evidenciaId: pick(item, ['EvidenciaID', 'id']), nombre, nota }, sessionToken);
      patchEvidence(result);
      setNotice('Evidencia actualizada. En una boleta finalizada, use “Reenviar a chats” para compartir el nuevo reporte.');
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
    try {
      const evidenceId = pick(item, ['EvidenciaID', 'id']);
      await requestAvailable(MODULE_ROUTES.tickets.evidenceDelete, { evidenciaId }, sessionToken);
      removeEvidence(evidenceId);
      setNotice('Evidencia eliminada. En una boleta finalizada, use “Reenviar a chats” para compartir el nuevo reporte.');
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  if (loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boleta...</span></div></div>;
  if (!data) return <div className="page page--narrow"><div className="alert alert--error"><Icon name="error" /><span>{error || 'No se encontró la boleta.'}</span></div><button className="button button--secondary" type="button" onClick={() => navigate('/boletas/pendientes')}><Icon name="arrow_back" /> Volver</button></div>;

  const evidences = data?.evidencias || data?.evidences || [];
  const imageEvidenceItems = evidences.map(ticketImageViewerItem).filter(Boolean);
  const imageEvidenceIndexByKey = new Map(imageEvidenceItems.map((item, index) => [item.key, index]));
  const assigned = (data?.asignados || []).map((item) => pick(item, ['NombreCompleto', 'Nombre', 'NombreUsuarioSnapshot', 'NombreUsuario', 'Correo', 'name'])).filter(Boolean).join(', ');
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
      <div className="page-header ticket-detail-header"><button className="icon-button" type="button" onClick={() => navigate(backTo)} aria-label="Volver"><Icon name="arrow_back" /></button><div><span className="eyebrow">Detalle de servicio</span><h1>Boleta #{String(displayId).slice(0, 20)}</h1></div><button className="icon-button" type="button" onClick={() => shareTicket(displayId)} aria-label="Compartir"><Icon name="share" /></button></div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
      {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}
      {finalized && canEdit && <div className="info-box"><Icon name="edit_note" /><p>Esta boleta está finalizada, pero puede corregir sus datos, firma y evidencias. Después use <strong>Reenviar a chats</strong> para generar el PDF actualizado.</p></div>}

      <section className="ticket-status-card"><div><span>Estado actual</span><TicketStatusChip status={status} /></div><div><span>Fecha de asignación</span><strong>{formatDate(pick(record, ['Fecha', 'FechaCreacion']))}</strong></div></section>

      <DetailSection title="Información General" icon="description" open><InfoGrid items={[
        ['Título', pick(record, ['Titulo', 'Título']), true], ['Categoría', pick(record, ['Categoria', 'Categoría'])], ['Tipo de falla', pick(record, ['TipoFalla'])], ['Fecha', formatDate(pick(record, ['Fecha']))], ['Hora inicio', formatTime(pick(record, ['HoraInicio']))], ['Hora final', formatTime(pick(record, ['HoraFinal']))], ['Horas totales', pick(record, ['HorasTotales'], '0.00')],
      ]} /></DetailSection>

      <DetailSection title="Cliente" icon="corporate_fare"><InfoGrid items={[
        ['Cliente', pick(record, ['Cliente', 'ClienteNombre']), true], ['Ubicación', pick(record, ['Ubicacion', 'Ubicación'])], ['Ubicación del equipo', pick(record, ['UbicacionEquipo', 'Ubicacion_equipo'])], ['Supervisor', pick(record, ['Supervisor'])], ['Correo supervisor', pick(record, ['CorreoSupervisor'])], ['Correo cliente', pick(record, ['CorreoCliente', 'Correo_Cliente'])],
      ]} /></DetailSection>

      <DetailSection title="Dispositivo / Equipo" icon="devices_other"><InfoGrid items={[
        ['Nombre del dispositivo', deviceName, true], ['Tipo', pick(record, ['TipoDispositivo'])], ['Fabricante', pick(record, ['Fabricante'])], ['Modelo', pick(record, ['Modelo'])], ['Serie', pick(record, ['Serie'])], ['Dirección MAC', normalizeMacAddress(pick(record, ['DireccionMAC', 'MACAddress', 'MacAddress']))],
      ]} /></DetailSection>

      <DetailSection title="Trabajo Realizado" icon="engineering"><InfoGrid items={[
        ['Razón de visita', pick(record, ['RazonVisita', 'Razon_visita']), true], ['Pruebas realizadas', pick(record, ['PruebasRealizadas', 'Pruebas realizadas']), true], ['Resultado', pick(record, ['Resultado']), true], ['Recomendaciones', pick(record, ['Recomendaciones']), true], ['Técnicos asignados', assigned, true],
      ]} /></DetailSection>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">Archivos</span><h2>Evidencias</h2></div></div>
        {evidences.length ? <div className="evidence-gallery">{evidences.map((item, index) => {
          const evidenceId = pick(item, ['EvidenciaID', 'id']);
          const fileId = pick(item, ['ArchivoFileID', 'ArchivoID', 'fileId']);
          const url = pick(item, ['ArchivoURL', 'URL', 'url']);
          const mimeType = pick(item, ['MimeType', 'mimeType']);
          const mediaKind = pick(item, ['TipoMedio', 'MediaType', 'mediaType']);
          const name = pick(item, ['Nombre', 'name'], `Evidencia ${index + 1}`);
          const note = pick(item, ['Nota', 'note']);
          const galleryKey = String(evidenceId || fileId || index);
          const galleryIndex = imageEvidenceIndexByKey.get(galleryKey) ?? 0;
          return <article className="evidence-detail-card" key={evidenceId || index}><MediaPreview boletaUid={boletaUid} evidenceId={evidenceId} fileId={fileId} directUrl={url} mimeType={mimeType} mediaKind={mediaKind} alt={name} onOpen={() => setViewer({ items: imageEvidenceItems, initialIndex: galleryIndex })} /><div><strong>{name}</strong>{note && <p>{note}</p>}{String(pick(item, ['TipoMedio'])).toUpperCase() === 'VIDEO' && <small>Video · {Math.ceil(Number(pick(item, ['DuracionSegundos'], 0)))} s</small>}</div>{canEvidence && <div className="evidence-detail-card__actions"><button type="button" onClick={() => editEvidence(item)} disabled={processing} aria-label={`Editar ${name}`}><Icon name="edit" /></button><button type="button" onClick={() => deleteEvidence(item)} disabled={processing} aria-label={`Eliminar ${name}`}><Icon name="delete" /></button></div>}</article>;
        })}</div> : <div className="empty-state"><Icon name="perm_media" /><h2>Sin evidencias</h2><p>No hay archivos asociados a esta boleta.</p></div>}

        {canEvidence && <form className="evidence-inline-form ticket-detail-evidence-form" onSubmit={uploadEvidence}>
          <div className="ticket-detail-capture-actions">
            <input key={`camera-${evidenceInputVersion}`} ref={cameraInputRef} className="ticket-detail-hidden-input" type="file" accept="image/*" capture="environment" onChange={(event) => selectEvidenceFile(event.target.files?.[0], 'camera')} />
            <button className="button button--primary" type="button" onClick={() => cameraInputRef.current?.click()} disabled={processing}><Icon name="photo_camera" /> Tomar foto</button>
            <input key={`video-${evidenceInputVersion}`} ref={videoInputRef} className="ticket-detail-hidden-input" type="file" accept="video/mp4,video/webm,video/quicktime,video/*" capture="environment" onChange={(event) => selectEvidenceFile(event.target.files?.[0], 'camera')} />
            <button className="button button--secondary" type="button" onClick={() => videoInputRef.current?.click()} disabled={processing}><Icon name="videocam" /> Grabar video</button>
            <button className="button button--secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={processing}><Icon name="upload_file" /> Seleccionar archivo</button>
            <input key={`file-${evidenceInputVersion}`} ref={fileInputRef} className="ticket-detail-hidden-input" type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm,.pdf,.doc,.docx" onChange={(event) => selectEvidenceFile(event.target.files?.[0], 'file')} />
          </div>
          <div className="info-box"><Icon name="info" /><p>Los videos deben durar máximo 1 minuto y 30 segundos y pesar hasta 300 MB. Los videos mayores de 30 MB se cargan por partes y requieren conexión a internet.</p></div>
          {evidenceForm.file && <div className="ticket-detail-selected-file"><Icon name={evidenceForm.mediaType === 'video' ? 'videocam' : 'check_circle'} /><span>{evidenceForm.file.name}{evidenceForm.mediaType === 'video' ? ` · ${Math.ceil(evidenceForm.durationSeconds)} s` : ''}</span></div>}
          <input className="form-control" value={evidenceForm.name} onChange={(event) => setEvidenceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre de la evidencia" />
          <input className="form-control" value={evidenceForm.note} onChange={(event) => setEvidenceForm((current) => ({ ...current, note: event.target.value }))} placeholder="Nota opcional" />
          <button className="button button--primary" disabled={processing || !evidenceForm.file}><Icon name="add_to_photos" /> {processing ? 'Guardando...' : 'Añadir evidencia'}</button>
        </form>}
      </section>

      <section className="section-block">
        <div className="section-heading ticket-signature-heading"><div><span className="eyebrow">Conformidad</span><h2>Firma del Cliente</h2></div>{canEdit && !signatureEditorOpen && <button className="button button--secondary button--compact" type="button" onClick={() => { setSignatureDraft(''); setSignatureEditorOpen(true); }}><Icon name="draw" /> {signatureFileId || signatureUrl ? 'Editar firma' : 'Agregar firma'}</button>}</div>
        {signatureEditorOpen ? <div className="ticket-signature-editor"><SignaturePad value={signatureDraft} onChange={setSignatureDraft} /><div className="ticket-signature-editor__actions"><button className="button button--secondary" type="button" disabled={processing} onClick={() => { setSignatureDraft(''); setSignatureEditorOpen(false); }}><Icon name="close" /> Cancelar</button><button className="button button--primary" type="button" disabled={processing || !signatureDraft} onClick={saveSignature}><Icon name="save" /> {processing ? 'Guardando...' : 'Guardar firma'}</button></div></div> : <div className="signature-display">{signatureFileId || signatureUrl ? <MediaPreview boletaUid={boletaUid} fileId={signatureFileId} kind="signature" directUrl={signatureUrl} mimeType="image/png" alt="Firma del cliente" onOpen={() => setViewer({ items: [{ key: 'signature', fileId: signatureFileId, directUrl: signatureUrl, mimeType: 'image/png', alt: 'Firma del cliente', kind: 'signature' }], initialIndex: 0 })} /> : <span><Icon name="draw" /> Firma pendiente</span>}</div>}
      </section>

      <section className="document-links"><h2>Documentos</h2><div>{documentUrl && <a className="button button--secondary" href={documentUrl} target="_blank" rel="noreferrer"><Icon name="description" /> Google Doc</a>}{pdfUrl && <a className="button button--secondary" href={pdfUrl} target="_blank" rel="noreferrer"><Icon name="picture_as_pdf" /> PDF</a>}{folderUrl && <a className="button button--secondary" href={folderUrl} target="_blank" rel="noreferrer"><Icon name="folder" /> Carpeta Drive</a>}</div></section>

      <div className="ticket-detail-actions">
        {canEdit && <Link className="button button--secondary" to={`/boletas/${encodeURIComponent(boletaUid)}/editar`}><Icon name="edit" /> Editar</Link>}
        {canTest && !finalized && <button className="button button--secondary" type="button" onClick={() => finalAction('test')} disabled={processing}><Icon name="science" /> Probar</button>}
        {finalized ? <>{pdfUrl && <a className="button button--secondary" href={pdfUrl} target="_blank" rel="noreferrer"><Icon name="picture_as_pdf" /> Abrir PDF</a>}{canResend && <button className="button button--primary button--wide" type="button" onClick={() => finalAction('resend')} disabled={processing}><Icon name="send" /> {processing ? 'Reenviando...' : 'Reenviar a chats'}</button>}{canAdmin && <button className="button button--secondary" type="button" onClick={() => finalAction('pending')} disabled={processing}><Icon name="undo" /> Volver a pendiente</button>}</> : canFinalize && <button className="button button--primary button--wide" type="button" onClick={() => finalAction('finalize')} disabled={processing}><Icon name="task_alt" /> {processing ? 'Procesando...' : 'Finalizar boleta'}</button>}
      </div>

      <ImageViewer boletaUid={boletaUid} open={Boolean(viewer)} items={viewer?.items || []} initialIndex={viewer?.initialIndex || 0} onClose={() => setViewer(null)} />
    </div>
  );
}
