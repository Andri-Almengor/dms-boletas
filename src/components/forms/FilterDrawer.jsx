import React from 'react';
import Icon from '../common/Icon';

export default function FilterDrawer({ open, title = 'Filtros', children, onClose, onApply, onClear }) {
  if (!open) return null;
  return <div className="filter-drawer-layer" role="dialog" aria-modal="true" aria-label={title}>
    <button type="button" className="modal-backdrop" onClick={onClose} aria-label="Cerrar filtros" />
    <aside className="filter-drawer"><header><div><span className="eyebrow">Búsqueda avanzada</span><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose}><Icon name="close" /></button></header><div className="filter-drawer__content">{children}</div><footer><button className="button button--secondary" type="button" onClick={onClear}>Limpiar</button><button className="button button--primary" type="button" onClick={onApply}>Aplicar filtros</button></footer></aside>
  </div>;
}
