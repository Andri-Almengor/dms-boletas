import React, { useEffect } from 'react';
import Icon from '../common/Icon';

export default function InlineCreateModal({ open, title, description, children, saving, error, onClose, onSubmit }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) { if (event.key === 'Escape' && !saving) onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);
  if (!open) return null;
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button type="button" className="modal-backdrop" onClick={saving ? undefined : onClose} aria-label="Cerrar" /><section className="inline-modal"><header className="inline-modal__header"><div><span className="eyebrow">Agregar nuevo registro</span><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" type="button" onClick={onClose} disabled={saving}><Icon name="close" /></button></header><form className="stack-form" onSubmit={onSubmit}>{error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}{children}<div className="inline-modal__actions"><button className="button button--secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button></div></form></section></div>;
}
