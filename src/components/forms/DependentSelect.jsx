import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { sortOptionsNaturally } from '../../utils/naturalSort';
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
  selectedLabel = '',
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
  onSearch,
  searchDelay = 300,
  searchMinLength = 0,
  allowCustomValue = false,
  hint = '',
}) {
  const { hasPermission } = useAuth();
  const generatedId = useId();
  const fieldId = name || generatedId;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const canAddFromOperation = Boolean(onAdd) && (
    hasPermission('BOLETAS_CREAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('CATALOGOS_GESTIONAR')
  );
  const showAddButton = Boolean(onAdd) && (canAdd || canAddFromOperation);
  const normalizedLabel = normalizeSearch(label);
  const useSearchable = searchable ?? normalizedLabel === 'cliente';
  const displayedOptions = useMemo(() => sortOptionsNaturally(options), [options]);
  const selectedOption = displayedOptions.find((option) => String(option.value) === String(value || ''))
    || (value && selectedLabel ? { value: String(value), label: String(selectedLabel) } : null)
    || (allowCustomValue && value ? { value: String(value), label: String(value) } : null);

  const filteredOptions = useMemo(() => {
    const term = normalizeSearch(query);
    if (!term || (!allowCustomValue && term === normalizeSearch(selectedOption?.label))) return displayedOptions;
    return displayedOptions.filter((option) => normalizeSearch(option.label).includes(term));
  }, [displayedOptions, query, selectedOption, allowCustomValue]);

  useEffect(() => {
    if (!open) setQuery(selectedOption?.label || '');
  }, [open, selectedOption]);

  useEffect(() => {
    if (!useSearchable || !open || typeof onSearch !== 'function') {
      setRemoteLoading(false);
      return undefined;
    }

    const term = String(query || '').trim();
    if (term.length < Math.max(0, Number(searchMinLength || 0))) {
      setRemoteLoading(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setRemoteLoading(true);
      Promise.resolve(onSearch(term))
        .catch(() => {})
        .finally(() => {
          if (active) setRemoteLoading(false);
        });
    }, Math.max(0, Number(searchDelay || 0)));

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onSearch, open, query, searchDelay, searchMinLength, useSearchable]);

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
    setActiveIndex(-1);
    requestAnimationFrame(() => inputRef.current?.blur());
  }

  function clearSelection(event) {
    event.preventDefault();
    event.stopPropagation();
    emitChange('');
    setQuery('');
    setOpen(true);
    setActiveIndex(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
      return;
    }
    if (allowCustomValue && open && filteredOptions.length
      && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActiveIndex((index) => event.key === 'ArrowDown'
        ? Math.min(index + 1, filteredOptions.length - 1)
        : (index <= 0 ? filteredOptions.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter' && open) {
      // En modo libre, solo una selección explícita (flechas+Enter o clic)
      // escoge una sugerencia. Enter a secas conserva exactamente lo escrito.
      if (allowCustomValue) {
        event.preventDefault();
        if (activeIndex >= 0 && filteredOptions[activeIndex]) {
          chooseOption(filteredOptions[activeIndex]);
        } else {
          setOpen(false);
        }
      } else if (filteredOptions.length) {
        event.preventDefault();
        chooseOption(filteredOptions[0]);
      }
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
            aria-busy={remoteLoading}
            aria-activedescendant={allowCustomValue && open && activeIndex >= 0
              ? `${fieldId}-option-${activeIndex}` : undefined}
            role="combobox"
            onFocus={(event) => {
              setOpen(true);
              if (selectedOption) event.currentTarget.select();
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(-1);
              if (allowCustomValue) emitChange(event.target.value);
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
              {filteredOptions.length ? filteredOptions.map((option, index) => {
                const selected = String(option.value) === String(value || '');
                return (
                  <button
                    key={option.value}
                    id={`${fieldId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`searchable-select__option${selected ? ' is-selected' : ''}${allowCustomValue && index === activeIndex ? ' is-active' : ''}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => chooseOption(option)}
                  >
                    <span>{option.label}</span>
                    {selected && <Icon name="check" />}
                  </button>
                );
              }) : (
                <div className="searchable-select__empty">{remoteLoading ? 'Buscando...' : allowCustomValue
                  ? 'Sin coincidencias. Puede conservar el nombre escrito.' : 'No se encontraron coincidencias.'}</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="select-shell">
          <select id={fieldId} name={name} className="form-control" value={value} onChange={onChange} disabled={disabled || loading} required={required}>
            <option value="">{loading ? 'Cargando...' : placeholder}</option>
            {displayedOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Icon name="expand_more" />
        </div>
      )}
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}
