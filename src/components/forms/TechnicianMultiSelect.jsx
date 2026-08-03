import React, { useMemo, useState } from 'react';
import Icon from '../common/Icon';

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function TechnicianMultiSelect({ users = [], selectedIds = [], onChange, disabled }) {
  const [search, setSearch] = useState('');
  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const filtered = useMemo(() => {
    const term = normalized(search);
    return users.filter((item) => !term || normalized(`${item.label} ${item.note || ''}`).includes(term));
  }, [users, search]);
  const selected = users.filter((item) => selectedSet.has(String(item.value)));

  function toggle(value) {
    const id = String(value);
    onChange(selectedSet.has(id)
      ? selectedIds.filter((item) => String(item) !== id)
      : [...selectedIds.map(String), id]);
  }

  return <div className="technician-select">
    <label className="field-group">
      <span className="field-label">Buscar técnicos</span>
      <div className="technician-select__search">
        <Icon name="search" className="technician-select__search-icon" />
        <input
          type="search"
          className="technician-select__search-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre..."
          aria-label="Buscar técnicos por nombre o correo"
          autoComplete="off"
          disabled={disabled}
        />
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
