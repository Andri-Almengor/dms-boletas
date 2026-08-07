import React, { useMemo, useState } from 'react';
import Icon from '../common/Icon';
import '../../styles/assistant-gateway-snapshot.css';

function formatExpiry(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CR', { timeStyle: 'short' }).format(date);
}

export default function GatewaySnapshotCard({ snapshot }) {
  const [failed, setFailed] = useState(false);
  const expiry = useMemo(() => formatExpiry(snapshot?.expiresAt), [snapshot?.expiresAt]);
  if (!snapshot?.url) return null;

  return (
    <figure className="assistant-gateway-snapshot">
      <div className="assistant-gateway-snapshot__heading">
        <span><Icon name="photo_camera" /> Captura temporal del Gateway</span>
        {expiry && <small>Disponible hasta {expiry}</small>}
      </div>

      {failed ? (
        <div className="assistant-gateway-snapshot__expired">
          <Icon name="image_not_supported" />
          <div>
            <strong>La captura ya no está disponible.</strong>
            <span>Las imágenes del Gateway son temporales. Solicite una captura nueva desde el chat.</span>
          </div>
        </div>
      ) : (
        <a
          className="assistant-gateway-snapshot__image-link"
          href={snapshot.url}
          target="_blank"
          rel="noreferrer"
          title="Abrir captura en tamaño completo"
        >
          <img
            src={snapshot.url}
            alt={`Captura de ${snapshot.camera || 'cámara del Gateway'}`}
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </a>
      )}

      <figcaption>
        <span>{snapshot.camera || 'Cámara del Gateway'}</span>
        <small>La imagen no se guarda en el historial y expira automáticamente.</small>
      </figcaption>
    </figure>
  );
}
