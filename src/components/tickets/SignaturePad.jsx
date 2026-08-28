import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import Icon from '../common/Icon';

const MAX_SIGNATURE_SOURCE_BYTES = 12 * 1024 * 1024;

function currentRoute() {
  if (typeof window === 'undefined') return '';
  return `${window.location.pathname}${window.location.search || ''}`;
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo abrir la imagen. Use una foto JPG/PNG o una captura de pantalla.'));
    image.src = source;
  });
}

function looksLikeImage(file) {
  const mimeType = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return mimeType.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(name);
}

export default function SignaturePad({ value, onChange }) {
  const { boletaUid } = useParams();
  const { sessionToken } = useAuth();
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const drawingRef = useRef(false);
  const storedSourceRef = useRef('');
  const [existingSource, setExistingSource] = useState('');
  const [existingStatus, setExistingStatus] = useState(boletaUid ? 'loading' : 'none');
  const [expanded, setExpanded] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');

  function publishSignature(nextValue) {
    onChange(nextValue);
    window.dispatchEvent(new CustomEvent('dms-signature-draft-change', {
      detail: { route: currentRoute(), value: nextValue },
    }));
  }

  useEffect(() => {
    let active = true;
    if (!boletaUid) {
      setExistingStatus('none');
      return undefined;
    }

    setExistingStatus('loading');
    requestAvailable(MODULE_ROUTES.tickets.mediaGet, { boletaUid, kind: 'signature' }, sessionToken)
      .then((data) => {
        if (!active) return;
        const source = data?.dataUrl || data?.DataURL || '';
        if (!source) throw new Error('El backend no devolvió la firma almacenada.');
        storedSourceRef.current = source;
        setExistingSource(source);
        setExistingStatus('loaded');
      })
      .catch((error) => {
        if (!active) return;
        const text = String(error?.message || '').toLowerCase();
        if (text.includes('no tiene una firma') || text.includes('no se encontró')) setExistingStatus('none');
        else setExistingStatus('error');
      });

    return () => { active = false; };
  }, [boletaUid, sessionToken]);

  useEffect(() => {
    const restore = (event) => {
      const detail = event.detail || {};
      if (detail.route && detail.route !== currentRoute()) return;
      const restored = String(detail.value || '');
      if (!restored.startsWith('data:image/') || restored === value) return;
      setExistingSource('');
      onChange(restored);
    };
    window.addEventListener('dms-draft-restore-signature', restore);
    return () => window.removeEventListener('dms-draft-restore-signature', restore);
  }, [onChange, value]);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const source = value || existingSource;
    if (!source) return undefined;

    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = source;
    return () => { active = false; };
  }, [value, existingSource]);

  function pointFromEvent(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startDrawing(event) {
    event.preventDefault();
    setImageError('');
    const context = canvasRef.current.getContext('2d');
    const point = pointFromEvent(event);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const point = pointFromEvent(event);
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.strokeStyle = '#1b1c1c';
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    publishSignature(canvasRef.current.toDataURL('image/png'));
  }

  async function importSignatureImage(file) {
    if (!file) return;
    setImageError('');
    if (!looksLikeImage(file)) {
      setImageError('Seleccione una imagen de firma válida.');
      return;
    }
    if (Number(file.size || 0) > MAX_SIGNATURE_SOURCE_BYTES) {
      setImageError('La imagen seleccionada supera 12 MB. Use una imagen más pequeña.');
      return;
    }

    setImageBusy(true);
    try {
      const source = await fileAsDataUrl(file);
      const image = await loadImage(source);
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) throw new Error('No se pudo preparar el área de firma.');

      const padding = Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.05));
      const availableWidth = Math.max(1, canvas.width - padding * 2);
      const availableHeight = Math.max(1, canvas.height - padding * 2);
      const sourceWidth = Math.max(1, Number(image.naturalWidth || image.width || 1));
      const sourceHeight = Math.max(1, Number(image.naturalHeight || image.height || 1));
      const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
      const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
      const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
      const x = Math.round((canvas.width - drawWidth) / 2);
      const y = Math.round((canvas.height - drawHeight) / 2);

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, x, y, drawWidth, drawHeight);
      setExistingSource('');
      publishSignature(canvas.toDataURL('image/png'));
    } catch (error) {
      setImageError(error?.message || 'No se pudo preparar la imagen de firma.');
    } finally {
      setImageBusy(false);
    }
  }

  function chooseSignatureImage() {
    setImageError('');
    fileInputRef.current?.click();
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setExistingSource('');
    setImageError('');
    publishSignature('');
  }

  function restoreExistingSignature() {
    if (!storedSourceRef.current) return;
    onChange('');
    setExistingSource(storedSourceRef.current);
    setExistingStatus('loaded');
    setImageError('');
    window.dispatchEvent(new CustomEvent('dms-signature-draft-change', {
      detail: { route: currentRoute(), value: '' },
    }));
  }

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="signature-pad__expand-backdrop"
          aria-label="Cerrar la firma ampliada"
          onClick={() => setExpanded(false)}
        />
      )}
      <div
        className={`signature-pad${expanded ? ' is-expanded' : ''}`}
        data-offline-editing-surface
        role={expanded ? 'dialog' : undefined}
        aria-modal={expanded ? 'true' : undefined}
        aria-label={expanded ? 'Firma ampliada' : undefined}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.png,.jpg,.jpeg,.webp,.heic,.heif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            importSignatureImage(file);
          }}
        />
        <div className="signature-pad__toolbar">
          <span><Icon name="draw" /> Dibuje o cargue la firma</span>
          <div className="inline-actions">
            {!value && !existingSource && storedSourceRef.current && (
              <button type="button" className="button button--secondary button--compact" onClick={restoreExistingSignature} disabled={imageBusy}>
                <Icon name="restore" /> Restaurar firma existente
              </button>
            )}
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={chooseSignatureImage}
              disabled={imageBusy}
            >
              <Icon name={imageBusy ? 'progress_activity' : 'upload_file'} />
              {imageBusy ? 'Preparando imagen...' : 'Cargar imagen'}
            </button>
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              disabled={imageBusy}
            >
              <Icon name={expanded ? 'close_fullscreen' : 'open_in_full'} />
              {expanded ? 'Reducir firma' : 'Ampliar firma'}
            </button>
            <button type="button" className="button button--secondary button--compact" onClick={clearSignature} disabled={imageBusy}>
              <Icon name="ink_eraser" /> Limpiar
            </button>
          </div>
        </div>
        <small className="field-hint">Puede firmar con el dedo/mouse o seleccionar una foto, captura o archivo de imagen. La imagen se adapta automáticamente al recuadro de firma.</small>
        {imageError && <small className="field-error">{imageError}</small>}
        {existingStatus === 'loading' && <small className="field-hint">Cargando la firma guardada...</small>}
        {existingStatus === 'loaded' && !value && existingSource && <small className="field-hint">Firma existente cargada. Se conservará mientras no dibuje o cargue una firma nueva.</small>}
        {existingStatus === 'error' && <small className="field-error">No se pudo mostrar la firma existente, pero el archivo almacenado no será eliminado al guardar.</small>}
        {!value && !existingSource && storedSourceRef.current && <small className="field-hint">La vista fue limpiada. La firma almacenada sigue conservándose; puede restaurarla, dibujar una nueva o cargar una imagen.</small>}
        <canvas
          ref={canvasRef}
          data-draft-signature="primary"
          width="900"
          height="300"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
    </>
  );
}
