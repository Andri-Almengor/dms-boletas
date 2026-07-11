import React from 'react';
import Icon from '../common/Icon';

export default function DependentSelect({ label, value, onChange, options, placeholder = 'Seleccione una opción', disabled, loading, addLabel, onAdd, canAdd = false, required = false, name }) {
  return <div className="field-group">
    <div className="field-label-row"><label className="field-label" htmlFor={name}>{label}</label>{canAdd && onAdd && <button className="field-add-button" type="button" onClick={onAdd} disabled={disabled}><Icon name="add" /> {addLabel || 'Agregar'}</button>}</div>
    <div className="select-shell"><select id={name} name={name} className="form-control" value={value} onChange={onChange} disabled={disabled || loading} required={required}><option value="">{loading ? 'Cargando...' : placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="expand_more" /></div>
  </div>;
}
