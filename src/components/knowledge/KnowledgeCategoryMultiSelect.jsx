import React, { useMemo, useState } from 'react';
import Icon from '../common/Icon';

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function KnowledgeCategoryMultiSelect({
  options = [],
  selectedIds = [],
  onChange,
  disabled = false,
}) {
  const [search, setSearch] = useState('');
  const selected = selectedIds.map(String);
  const optionMap = useMemo(() => new Map(options.map((option) => [String(option.value), option])), [options]);
  const visible = useMemo(() => {
    const query = normalized(search);
    if (!query) return options;
    return options.filter((option) => normalized(option.label).includes(query));
  }, [options, search]);

  function toggle(id) {
    if (disabled) return;
    const value = String(id);
    if (selected.includes(value)) onChange(selected.filter((item) => item !== value));
    else onChange([...selected, value]);
  }

  function remove(id) {
    if (disabled) return;
    onChange(selected.filter((item) => item !== String(id)));
  }

  return (
    <div className={`knowledge-category-multiselect${disabled ? ' is-disabled' : ''}`}>
      <div className="knowledge-category-multiselect__summary">
        <div>
          <span className="field-label">Categorías del tutorial *</span>
          <small>Puede combinar varias tecnologías. La primera se considera la categoría principal.</small>
        </div>
        <strong>{selected.length} seleccionada{selected.length === 1 ? '' : 's'}</strong>
      </div>

      {selected.length > 0 && (
        <div className="knowledge-category-multiselect__selected" aria-label="Categorías seleccionadas">
          {selected.map((id, index) => {
            const option = optionMap.get(id);
            return (
              <span key={id} className={index === 0 ? 'is-primary' : ''}>
                {index === 0 && <Icon name="star" />}
                {option?.label || 'Categoría'}
                {!disabled && (
                  <button type="button" onClick={() => remove(id)} aria-label={`Quitar ${option?.label || 'categoría'}`}>
                    <Icon name="close" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <label className="knowledge-category-multiselect__search">
        <Icon name="search" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar Milestone, Axis, Lenel..."
          disabled={disabled}
        />
      </label>

      <div className="knowledge-category-multiselect__options">
        {visible.map((option) => {
          const id = String(option.value);
          const checked = selected.includes(id);
          return (
            <label key={id} className={checked ? 'is-selected' : ''}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(id)}
                disabled={disabled}
              />
              <span className="knowledge-category-multiselect__check"><Icon name={checked ? 'check' : 'add'} /></span>
              <strong>{option.label}</strong>
            </label>
          );
        })}
        {!visible.length && <div className="knowledge-category-multiselect__empty">No hay categorías que coincidan con la búsqueda.</div>}
      </div>
    </div>
  );
}
