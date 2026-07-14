import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function DependentSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Seleccione una opción',
  disabled,
  loading,
  addLabel,
  onAdd,
  canAdd = false,
  required = false,
  name,
  searchable,
  searchPlaceholder,
}) {
  const { hasPermission } = useAuth();
  const generatedId = useId();
  const fieldId = name || generatedId;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const canAddFromOperation = Boolean(onAdd) && (
    hasPermission('BOLETAS_CREAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('CATALOGOS_GESTIONAR')
  );
  const showAddButton = Boolean(onAdd) && (canAdd || canAddFromOperation);
  const normalizedLabel = normalizeSearch(label);
  const useSearchable = searchable ?? normalizedLabel === 'cliente';
  const selectedOption = options.find((option) => String(option.value) === String(value || '')) || null;

  const filteredOptions = useMemo(() => {
    const term = normalizeSearch(query);
    if (!term || term === normalizeSearch(selectedOption?.label)) return options;
    return options.filter((option) => normalizeSearch(option.label).includes(term));
  }, [options, query, selectedOption]);

  useEffect(() => {
    if (!open) setQuery(selectedOption?.label || '');
  }, [open, selectedOption]);

  useEffect(() => {
    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  function emitChange(nextValue) {
    onChange?.({
      target: { name, value: nextValue },
      currentTarget: { name, value: nextValue },
    });
  }

  function chooseOption(option) {
    emitChange(String(option.value));
    setQuery(option.label);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.blur());
  }

  function clearSelection(event) {
    event.preventDefault();
    event.stopPropagation();
    emitChange('');
    setQuery('');
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
    if (event.key === 'Enter' && open && filteredOptions.length) {
      event.preventDefault();
      chooseOption(filteredOptions[0]);
    }
  }

  return (
    <div className={`field-group${useSearchable && open ? ' field-group--select-open' : ''}`} ref={rootRef}>
      <div className="field-label-row">
        <label className="field-label" htmlFor={fieldId}>{label}</label>
        {showAddButton && (
          <button className="field-add-button" type="button" onClick={onAdd} disabled={disabled || loading}>
            <Icon name="add" /> {addLabel || 'Agregar'}
          </button>
        )}
      </div>

      {useSearchable ? (
        <div className={`searchable-select${open ? ' is-open' : ''}`}>
          <Icon name="search" className="searchable-select__leading" />
          <input
            ref={inputRef}
            id={fieldId}
            name={`${name || fieldId}-search`}
            className="form-control searchable-select__input"
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            placeholder={loading ? 'Cargando...' : (searchPlaceholder || `Buscar ${String(label || '').toLowerCase()}...`)}
            disabled={disabled || loading}
            aria-expanded={open}
            aria-controls={`${fieldId}-options`}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            role="combobox"
            onFocus={(event) => {
              setOpen(true);
              if (selectedOption) event.currentTarget.select();
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
          />
          {value ? (
            <button className="searchable-select__clear" type="button" aria-label={`Borrar ${label}`} onClick={clearSelection} disabled={disabled || loading}>
              <Icon name="close" />
            </button>
          ) : (
            <Icon name={open ? 'expand_less' : 'expand_more'} className="searchable-select__trailing" />
          )}
          <input type="hidden" name={name} value={value || ''} required={required} />

          {open && !disabled && !loading && (
            <div className="searchable-select__menu" id={`${fieldId}-options`} role="listbox">
              {filteredOptions.length ? filteredOptions.map((option) => {
                const selected = String(option.value) === String(value || '');
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`searchable-select__option${selected ? ' is-selected' : ''}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => chooseOption(option)}
                  >
                    <span>{option.label}</span>
                    {selected && <Icon name="check" />}
                  </button>
                );
              }) : (
                <div className="searchable-select__empty">No se encontraron coincidencias.</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="select-shell">
          <select id={fieldId} name={name} className="form-control" value={value} onChange={onChange} disabled={disabled || loading} required={required}>
            <option value="">{loading ? 'Cargando...' : placeholder}</option>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Icon name="expand_more" />
        </div>
      )}
    </div>
  );
}
