import React, { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

export default function MediaPreview({ boletaUid, fileId, directUrl, mimeType, alt, onOpen }) {
  const { sessionToken } = useAuth();
  const [source, setSource] = useState(directUrl || '');
  const [error, setError] = useState('');
  const image = String(mimeType || '').startsWith('image/') || String(source || '').startsWith('data:image/');

  useEffect(() => {
    let active = true;
    if (!fileId || (directUrl && !String(directUrl).includes('drive.google.com'))) return undefined;
    requestAvailable(MODULE_ROUTES.tickets.mediaGet, { boletaUid, fileId }, sessionToken)
      .then((data) => { if (active) setSource(data.dataUrl || directUrl || ''); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [boletaUid, fileId, directUrl, sessionToken]);

  if (!source && !error) return <div className="media-loading"><Icon name="progress_activity" /> Cargando...</div>;
  if (error && !source) return <div className="media-error"><Icon name="broken_image" /> No se pudo cargar</div>;
  if (!image) return <a className="evidence-file-link" href={source} target="_blank" rel="noreferrer"><Icon name="description" /> Abrir archivo</a>;
  return <button className="media-preview-button" type="button" onClick={() => onOpen?.(source)}><img src={source} alt={alt || 'Evidencia'} /></button>;
}
