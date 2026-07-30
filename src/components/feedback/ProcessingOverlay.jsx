import React from 'react';
import { createPortal } from 'react-dom';
import Icon from '../common/Icon';

export default function ProcessingOverlay({
  open,
  title = 'Procesando datos',
  message = 'Espere mientras se completa la operación.',
  detail = 'No cierre ni recargue esta pantalla.',
}) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="processing-overlay"
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
      aria-busy="true"
      aria-label={title}
    >
      <div className="processing-overlay__backdrop" />
      <section className="processing-overlay__card">
        <span className="processing-overlay__spinner" aria-hidden="true">
          <Icon name="progress_activity" />
        </span>
        <div className="processing-overlay__copy">
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="processing-overlay__progress" aria-hidden="true"><span /></div>
        {detail && <small>{detail}</small>}
      </section>
    </div>,
    document.body,
  );
}
