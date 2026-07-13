import React from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';

export default function DependentSelect({ label, value, onChange, options, placeholder = 'Seleccione una opción', disabled, loading, addLabel, onAdd, canAdd = false, required = false, name }) {
  const { hasPermission } = useAuth();
  const canAddFromOperation = Boolean(onAdd) && (
    hasPermission('BOLETAS_CREAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('CATALOGOS_GESTIONAR')
  );
  const showAddButton = Boolean(onAdd) && (canAdd || canAddFromOperation);

  return <div className="field-group">
    <div className="field-label-row"><label className="field-label" htmlFor={name}>{label}</label>{showAddButton && <button className="field-add-button" type="button" onClick={onAdd} disabled={disabled || loading}><Icon name="add" /> {addLabel || 'Agregar'}</button>}</div>
    <div className="select-shell"><select id={name} name={name} className="form-control" value={value} onChange={onChange} disabled={disabled || loading} required={required}><option value="">{loading ? 'Cargando...' : placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="expand_more" /></div>
  </div>;
}
