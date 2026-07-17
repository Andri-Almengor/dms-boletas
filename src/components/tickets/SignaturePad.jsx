import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import Icon from '../common/Icon';

function currentRoute() {
  if (typeof window === 'undefined') return '';
  return `${window.location.pathname}${window.location.search || ''}`;
}

export default function SignaturePad({ value, onChange }) {
  const { boletaUid } = useParams();
  const { sessionToken } = useAuth();
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const storedSourceRef = useRef('');
  const [existingSource, setExistingSource] = useState('');
  const [existingStatus, setExistingStatus] = useState(boletaUid ? 'loading' : 'none');

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

  function clearSignature() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setExistingSource('');
    publishSignature('');
  }

  function restoreExistingSignature() {
    if (!storedSourceRef.current) return;
    onChange('');
    setExistingSource(storedSourceRef.current);
    setExistingStatus('loaded');
    window.dispatchEvent(new CustomEvent('dms-signature-draft-change', {
      detail: { route: currentRoute(), value: '' },
    }));
  }

  return (
    <div className="signature-pad" data-offline-editing-surface>
      <div className="signature-pad__toolbar">
        <span><Icon name="draw" /> Firma en el recuadro</span>
        <div className="inline-actions">
          {!value && !existingSource && storedSourceRef.current && (
            <button type="button" className="button button--secondary button--compact" onClick={restoreExistingSignature}>
              <Icon name="restore" /> Restaurar firma existente
            </button>
          )}
          <button type="button" className="button button--secondary button--compact" onClick={clearSignature}>
            <Icon name="ink_eraser" /> Limpiar
          </button>
        </div>
      </div>
      {existingStatus === 'loading' && <small className="field-hint">Cargando la firma guardada...</small>}
      {existingStatus === 'loaded' && !value && existingSource && <small className="field-hint">Firma existente cargada. Se conservará mientras no dibuje una firma nueva.</small>}
      {existingStatus === 'error' && <small className="field-error">No se pudo mostrar la firma existente, pero el archivo almacenado no será eliminado al guardar.</small>}
      {!value && !existingSource && storedSourceRef.current && <small className="field-hint">La vista fue limpiada. La firma almacenada sigue conservándose; puede restaurarla o dibujar una nueva.</small>}
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
  );
}
