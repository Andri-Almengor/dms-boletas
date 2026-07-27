import React, { useEffect } from 'react';
import Icon from '../common/Icon';

export default function AdminEntityModal({
  open,
  title,
  subtitle = '',
  eyebrow = 'Detalle',
  icon = 'info',
  onClose,
  children,
  footer = null,
  className = '',
  busy = false,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, busy]);

  if (!open) return null;

  return (
    <div className={`admin-entity-modal-layer${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="admin-entity-modal__backdrop" onClick={() => !busy && onClose?.()} aria-label="Cerrar ventana" />
      <section className="admin-entity-modal">
        <header className="admin-entity-modal__header">
          <span className="admin-entity-modal__icon"><Icon name={icon} /></span>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
        </header>
        <div className="admin-entity-modal__content">{children}</div>
        {footer && <footer className="admin-entity-modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}
