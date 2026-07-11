import React, { useMemo, useState } from 'react';
import Icon from '../common/Icon';

export default function TechnicianMultiSelect({ users, selectedIds, onChange, disabled }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => users.filter((item) => item.label.toLowerCase().includes(search.toLowerCase())), [users, search]);
  const selected = users.filter((item) => selectedIds.includes(String(item.value)));
  function toggle(value) { const id = String(value); onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]); }
  return <div className="technician-select"><label className="field-group"><span className="field-label">Buscar técnicos</span><div className="input-shell"><Icon name="search" /><input className="form-control form-control--with-leading" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre..." disabled={disabled} /></div></label><div className="technician-chips">{selected.map((item) => <span className="technician-chip" key={item.value}>{item.label}<button type="button" onClick={() => toggle(item.value)} aria-label={`Quitar ${item.label}`} disabled={disabled}><Icon name="close" /></button></span>)}{!selected.length && <span className="muted-copy">No hay técnicos seleccionados.</span>}</div><div className="technician-options">{filtered.map((item) => <label key={item.value} className={selectedIds.includes(String(item.value)) ? 'is-selected' : ''}><input type="checkbox" checked={selectedIds.includes(String(item.value))} onChange={() => toggle(item.value)} disabled={disabled} /><span className="avatar avatar--small">{item.initials}</span><span><strong>{item.label}</strong>{item.note && <small>{item.note}</small>}</span><Icon name={selectedIds.includes(String(item.value)) ? 'check_circle' : 'radio_button_unchecked'} /></label>)}</div></div>;
}
