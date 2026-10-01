import React from 'react';
import { createPortal } from 'react-dom';
import Icon from '../common/Icon';
import ProcessingOverlay from '../feedback/ProcessingOverlay';
import useOverlaySurface from '../../hooks/useOverlaySurface';

export default function InlineCreateModal({
  open,
  title,
  description,
  children,
  saving,
  error,
  onClose,
  onSubmit,
}) {
  useOverlaySurface({ open, onClose, busy: saving });

  if (!open || typeof document === 'undefined') return null;

  function submitModal(event) {
    event.preventDefault();
    event.stopPropagation();
    onSubmit?.(event);
  }

  return createPortal(
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="modal-backdrop"
        onClick={saving ? undefined : onClose}
        aria-label="Cerrar"
      />
      <section className="inline-modal">
        <header className="inline-modal__header">
          <div>
            <span className="eyebrow">Agregar nuevo registro</span>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Cerrar ventana">
            <Icon name="close" />
          </button>
        </header>

        <form className="stack-form" onSubmit={submitModal}>
          {error && (
            <div className="alert alert--error">
              <Icon name="error" />
              <span>{error}</span>
            </div>
          )}
          {children}
          <div className="inline-modal__actions">
            <button className="button button--secondary" type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className="button button--primary" type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </section>
      <ProcessingOverlay
        open={Boolean(saving)}
        title="Guardando registro"
        message={`Se está agregando “${title}” y actualizando las opciones del formulario.`}
      />
    </div>,
    document.body,
  );
}
