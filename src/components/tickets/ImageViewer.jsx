import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';

export default function ImageViewer({ source, alt, open, onClose }) {
  const [zoom, setZoom] = useState(1);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setZoom(1);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(4, value + 0.25));
      if (event.key === '-') setZoom((value) => Math.max(1, value - 0.25));
    };
    window.addEventListener('keydown', handleKey);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, source, onClose]);

  if (!open) return null;
  return <div className="image-viewer" role="dialog" aria-modal="true" aria-label={alt || 'Visor de imagen'}>
    <header><span>{alt || 'Evidencia'}</span><button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar visor"><Icon name="close" /></button></header>
    <div className="image-viewer__canvas"><img src={source} alt={alt || 'Evidencia'} style={{ transform: `scale(${zoom})` }} /></div>
    <footer>
      <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.25))} disabled={zoom <= 1} aria-label="Alejar imagen"><Icon name="zoom_out" /></button>
      <span aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))} disabled={zoom >= 4} aria-label="Acercar imagen"><Icon name="zoom_in" /></button>
    </footer>
  </div>;
}
