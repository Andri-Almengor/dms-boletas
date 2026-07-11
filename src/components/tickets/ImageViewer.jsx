import React, { useEffect, useState } from 'react';
import Icon from '../common/Icon';

export default function ImageViewer({ source, alt, open, onClose }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => { if (open) setZoom(1); }, [open, source]);
  if (!open) return null;
  return <div className="image-viewer" role="dialog" aria-modal="true" aria-label={alt || 'Visor de imagen'}><header><span>{alt || 'Evidencia'}</span><button type="button" onClick={onClose}><Icon name="close" /></button></header><div className="image-viewer__canvas"><img src={source} alt={alt || 'Evidencia'} style={{ transform: `scale(${zoom})` }} /></div><footer><button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.25))}><Icon name="zoom_out" /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))}><Icon name="zoom_in" /></button></footer></div>;
}
