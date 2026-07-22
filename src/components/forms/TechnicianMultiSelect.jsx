import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function TechnicianMultiSelect({ users = [], selectedIds = [], onChange, disabled }) {
  const rootRef = useRef(null);
  const [search, setSearch] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const filtered = useMemo(() => {
    const term = normalized(search);
    return users.filter((item) => !term || normalized(`${item.label} ${item.note || ''}`).includes(term));
  }, [users, search]);
  const selected = users.filter((item) => selectedSet.has(String(item.value)));

  useEffect(() => {
    const closeOutside = (event) => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target)) return;
      setOptionsOpen(false);
    };
    const closeWithEscape = (event) => {
      if (event.key === 'Escape') setOptionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, []);

  function toggle(value) {
    const id = String(value);
    onChange(selectedSet.has(id)
      ? selectedIds.filter((item) => String(item) !== id)
      : [...selectedIds.map(String), id]);
    setOptionsOpen(true);
  }

  return <div ref={rootRef} className={`technician-select${optionsOpen ? ' is-options-open' : ''}`}>
    <label className="field-group">
      <span className="field-label">Buscar técnicos</span>
      <div className="input-shell technician-select__search">
        <Icon name="search" />
        <input
          className="form-control form-control--with-leading"
          value={search}
          onFocus={() => setOptionsOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            setOptionsOpen(true);
          }}
          placeholder="Buscar por nombre..."
          disabled={disabled}
        />
        <button
          type="button"
          className="technician-select__toggle"
          onClick={() => setOptionsOpen((current) => !current)}
          disabled={disabled}
          aria-expanded={optionsOpen}
          aria-label={optionsOpen ? 'Ocultar lista de técnicos' : 'Mostrar lista de técnicos'}
        >
          <Icon name={optionsOpen ? 'expand_less' : 'expand_more'} />
        </button>
      </div>
    </label>

    <div className="technician-chips">
      {selected.map((item) => <span className="technician-chip" key={item.value}>{item.label}<button type="button" onClick={() => toggle(item.value)} aria-label={`Quitar ${item.label}`} disabled={disabled}><Icon name="close" /></button></span>)}
      {!selected.length && <span className="muted-copy">No hay técnicos seleccionados.</span>}
    </div>

    <div className="technician-options">
      {filtered.map((item) => {
        const checked = selectedSet.has(String(item.value));
        return <label key={item.value} className={checked ? 'is-selected' : ''}>
          <input type="checkbox" checked={checked} onChange={() => toggle(item.value)} disabled={disabled} />
          <span className="avatar avatar--small">{item.initials}</span>
          <span><strong>{item.label}</strong>{item.note && <small>{item.note}</small>}</span>
          <Icon name={checked ? 'check_circle' : 'radio_button_unchecked'} />
        </label>;
      })}
      {!filtered.length && <span className="muted-copy technician-select__empty">No se encontraron técnicos con esa búsqueda.</span>}
    </div>
  </div>;
}
