import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';

export default function TechnicianMultiSelect({ users, selectedIds, onChange, disabled }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const filtered = useMemo(
    () => users.filter((item) => item.label.toLowerCase().includes(search.toLowerCase())),
    [users, search],
  );
  const selected = users.filter((item) => selectedIds.includes(String(item.value)));

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  function toggle(value) {
    const id = String(value);
    onChange(selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id]);
  }

  const summary = selected.length
    ? `${selected.length} técnico${selected.length === 1 ? '' : 's'} seleccionado${selected.length === 1 ? '' : 's'}`
    : 'Seleccionar técnicos';

  return <div ref={rootRef} className={`technician-select${open ? ' is-open' : ''}`}>
    <button
      type="button"
      className="technician-select__trigger"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      disabled={disabled}
    >
      <span className="technician-select__trigger-icon"><Icon name="groups" /></span>
      <span><strong>{summary}</strong><small>{selected.length ? selected.map((item) => item.label).join(', ') : 'Abra la lista para asignar el grupo de trabajo.'}</small></span>
      <Icon name={open ? 'expand_less' : 'expand_more'} />
    </button>

    <div className="technician-select__panel">
      <label className="field-group technician-select__search"><span className="field-label">Buscar técnicos</span><div className="input-shell"><Icon name="search" /><input className="form-control form-control--with-leading" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre..." disabled={disabled} /></div></label>
      <div className="technician-chips">{selected.map((item) => <span className="technician-chip" key={item.value}>{item.label}<button type="button" onClick={() => toggle(item.value)} aria-label={`Quitar ${item.label}`} disabled={disabled}><Icon name="close" /></button></span>)}{!selected.length && <span className="muted-copy">No hay técnicos seleccionados.</span>}</div>
      <div className="technician-options">{filtered.map((item) => <label key={item.value} className={selectedIds.includes(String(item.value)) ? 'is-selected' : ''}><input type="checkbox" checked={selectedIds.includes(String(item.value))} onChange={() => toggle(item.value)} disabled={disabled} /><span className="avatar avatar--small">{item.initials}</span><span><strong>{item.label}</strong>{item.note && <small>{item.note}</small>}</span><Icon name={selectedIds.includes(String(item.value)) ? 'check_circle' : 'radio_button_unchecked'} /></label>)}</div>
    </div>
  </div>;
}
