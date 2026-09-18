import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { getAttachmentId, getAttachmentName } from '../../utils/knowledge';
import '../../styles/knowledge-document-viewer.css';

const TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return 'Tamaño no disponible';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function statusLabel(value) {
  const status = String(value || '').toUpperCase();
  if (status === 'INDEXED' || status === 'READY') return 'Documento disponible';
  if (status === 'PROCESSING' || status === 'UPLOADED' || status === 'PENDING') return 'Procesando documento…';
  if (status === 'UNSUPPORTED') return 'Disponible sin extracción de texto';
  if (status === 'FAILED') return 'No se pudo extraer texto';
  return status || 'Documento disponible';
}

export default function KnowledgeDocumentViewer({
  tutorialId,
  attachment,
  sessionToken,
  compact = false,
  autoLoad = true,
  canEdit = false,
  onSetPrimary,
  onReindex,
  onDelete,
  onReplace,
}) {
  const attachmentId = getAttachmentId(attachment);
  const mimeType = String(pick(attachment, ['MimeType', 'mimeType'], 'application/octet-stream')).toLowerCase();
  const sizeBytes = Number(pick(attachment, ['SizeBytes', 'sizeBytes', 'Size', 'size'], 0)) || 0;
  const [access, setAccess] = useState(null);
  const [textPreview, setTextPreview] = useState('');
  const [loading, setLoading] = useState(Boolean(autoLoad));
  const [error, setError] = useState('');
  const shellRef = useRef(null);

  async function loadAccess() {
    if (!attachmentId) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.knowledge.mediaGet, {
        tutorialId,
        adjuntoId: attachmentId,
      }, sessionToken);
      setAccess(data);
    } catch (err) {
      setError(err.message || 'No se pudo abrir el documento.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setAccess(null);
    setTextPreview('');
    setError('');
    if (autoLoad) loadAccess();
  }, [attachmentId, tutorialId, sessionToken, autoLoad]);

  useEffect(() => {
    if (!access?.inlineUrl || !(mimeType.startsWith('text/') || mimeType === 'text/csv')) return;
    const controller = new AbortController();
    fetch(access.inlineUrl, {
      signal: controller.signal,
      headers: sizeBytes > TEXT_PREVIEW_BYTES ? { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } : {},
    })
      .then((response) => {
        if (!response.ok && response.status !== 206) throw new Error('No se pudo leer la vista previa.');
        return response.text();
      })
      .then((value) => setTextPreview(value))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [access?.inlineUrl, mimeType, sizeBytes]);

  function fullscreen() {
    shellRef.current?.requestFullscreen?.().catch(() => {});
  }

  const isPdf = mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/');
  const isText = mimeType.startsWith('text/') || mimeType === 'text/csv';
  const isPrimary = Boolean(pick(attachment, ['IsPrimary', 'isPrimary'], false));
  const extractionStatus = pick(attachment, ['ExtractionStatus', 'extractionStatus', 'Status'], 'UPLOADED');

  return <article className={`knowledge-doc-viewer${compact ? ' is-compact' : ''}`} ref={shellRef}>
    <header className="knowledge-doc-viewer__header">
      <div className="knowledge-doc-viewer__identity">
        <span className="knowledge-doc-viewer__icon"><Icon name={isPdf ? 'picture_as_pdf' : isImage ? 'image' : 'description'} /></span>
        <div>
          <strong>{getAttachmentName(attachment)}</strong>
          <span>{mimeType} · {formatBytes(sizeBytes)}</span>
          <small className={`knowledge-doc-viewer__status is-${String(extractionStatus || '').toLowerCase()}`}>
            {isPrimary && <><Icon name="star" /> Principal · </>}{statusLabel(extractionStatus)}
          </small>
        </div>
      </div>
      <div className="knowledge-doc-viewer__actions">
        {!access && <button type="button" className="button button--secondary button--compact" onClick={loadAccess} disabled={loading}><Icon name="visibility" /> Abrir</button>}
        {access?.inlineUrl && <a className="button button--secondary button--compact" href={access.inlineUrl} target="_blank" rel="noopener noreferrer"><Icon name="open_in_new" /> Abrir</a>}
        {access?.downloadUrl && <a className="button button--secondary button--compact" href={access.downloadUrl}><Icon name="download" /> Descargar</a>}
        {(isPdf || isImage || isText) && access?.inlineUrl && <button type="button" className="icon-button icon-button--outlined" onClick={fullscreen} title="Pantalla completa"><Icon name="fullscreen" /></button>}
      </div>
    </header>

    {loading && <div className="knowledge-doc-viewer__state"><Icon name="progress_activity" /> Preparando documento protegido…</div>}
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    {access?.inlineUrl && isPdf && <iframe className="knowledge-doc-viewer__pdf" src={access.inlineUrl} title={getAttachmentName(attachment)} />}
    {access?.inlineUrl && isImage && <div className="knowledge-doc-viewer__image-wrap"><img src={access.inlineUrl} alt={getAttachmentName(attachment)} /></div>}
    {access?.inlineUrl && isText && <pre className="knowledge-doc-viewer__text">{textPreview || 'Cargando texto…'}{sizeBytes > TEXT_PREVIEW_BYTES ? '\n\n[Vista previa acotada. Descargue el archivo para ver el contenido completo.]' : ''}</pre>}
    {access?.inlineUrl && !isPdf && !isImage && !isText && <div className="knowledge-doc-viewer__unsupported">
      <Icon name="draft" />
      <div><strong>Este formato no se renderiza dentro del navegador.</strong><span>Puede abrirlo o descargarlo usando el acceso privado de DMS.</span></div>
    </div>}

    {canEdit && <footer className="knowledge-doc-viewer__manage">
      {!isPrimary && <button type="button" onClick={() => onSetPrimary?.(attachment)}><Icon name="star" /> Marcar principal</button>}
      {String(extractionStatus).toUpperCase() === 'FAILED' && <button type="button" onClick={() => onReindex?.(attachment)}><Icon name="refresh" /> Reintentar indexación</button>}
      <button type="button" onClick={() => onReplace?.(attachment)}><Icon name="swap_horiz" /> Reemplazar</button>
      <button type="button" className="is-danger" onClick={() => onDelete?.(attachment)}><Icon name="delete" /> Eliminar</button>
    </footer>}
  </article>;
}
