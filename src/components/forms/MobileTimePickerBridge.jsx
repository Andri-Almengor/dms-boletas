import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../common/Icon';

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

function currentParts(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    return {
      hour: String(Math.min(23, Math.max(0, Number(match[1])))).padStart(2, '0'),
      minute: String(Math.min(59, Math.max(0, Number(match[2])))).padStart(2, '0'),
    };
  }
  const now = new Date();
  return {
    hour: String(now.getHours()).padStart(2, '0'),
    minute: String(now.getMinutes()).padStart(2, '0'),
  };
}

function fieldLabel(input) {
  return input.closest('.field-group')?.querySelector('.field-label')?.textContent?.trim() || 'Seleccionar hora';
}

function updateNativeInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function MobileTimePickerBridge() {
  const [target, setTarget] = useState(null);
  const [hour, setHour] = useState('08');
  const [minute, setMinute] = useState('00');
  const pendingInputRef = useRef(null);
  const openTimerRef = useRef(null);

  const openFor = useCallback((input) => {
    if (!input?.isConnected) return;
    const parts = currentParts(input.value);
    setHour(parts.hour);
    setMinute(parts.minute);
    setTarget({ input, label: fieldLabel(input) });
  }, []);

  useEffect(() => {
    function isMobileTimeInput(element) {
      const input = element?.closest?.('input[type="time"]');
      if (!input || input.disabled || input.readOnly) return null;
      return window.matchMedia('(max-width: 760px)').matches ? input : null;
    }

    function blockEvent(event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }

    function interceptPointerDown(event) {
      const input = isMobileTimeInput(event.target);
      if (!input) return;
      blockEvent(event);
      pendingInputRef.current = input;
    }

    function interceptPointerUp(event) {
      const input = pendingInputRef.current || isMobileTimeInput(event.target);
      if (!input) return;
      blockEvent(event);
      pendingInputRef.current = null;
      input.blur();
      window.clearTimeout(openTimerRef.current);
      // Se abre después del click sintetizado del teléfono. Así ese mismo toque
      // no cae sobre el fondo del modal y lo cierra inmediatamente.
      openTimerRef.current = window.setTimeout(() => openFor(input), 0);
    }

    function interceptClick(event) {
      const input = isMobileTimeInput(event.target);
      if (!input) return;
      blockEvent(event);
    }

    function cancelPointer() {
      pendingInputRef.current = null;
    }

    document.addEventListener('pointerdown', interceptPointerDown, true);
    document.addEventListener('pointerup', interceptPointerUp, true);
    document.addEventListener('pointercancel', cancelPointer, true);
    document.addEventListener('click', interceptClick, true);
    return () => {
      window.clearTimeout(openTimerRef.current);
      document.removeEventListener('pointerdown', interceptPointerDown, true);
      document.removeEventListener('pointerup', interceptPointerUp, true);
      document.removeEventListener('pointercancel', cancelPointer, true);
      document.removeEventListener('click', interceptClick, true);
    };
  }, [openFor]);

  useEffect(() => {
    if (!target) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function keydown(event) {
      if (event.key === 'Escape') setTarget(null);
      if (event.key === 'Enter') {
        event.preventDefault();
        if (target.input?.isConnected) updateNativeInput(target.input, `${hour}:${minute}`);
        setTarget(null);
      }
    }

    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keydown);
    };
  }, [target, hour, minute]);

  const display = useMemo(() => `${hour}:${minute}`, [hour, minute]);

  if (!target) return null;

  function applyValue(value) {
    if (target.input?.isConnected) updateNativeInput(target.input, value);
    setTarget(null);
  }

  return createPortal(
    <div className="mobile-time-layer" role="presentation">
      <button className="mobile-time-backdrop" type="button" aria-label="Cerrar selector de hora" onClick={() => setTarget(null)} />
      <section className="mobile-time-picker" role="dialog" aria-modal="true" aria-label={target.label}>
        <header className="mobile-time-picker__header">
          <div>
            <span className="eyebrow">Hora en formato 24 horas</span>
            <h2>{target.label}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setTarget(null)}>
            <Icon name="close" />
          </button>
        </header>

        <div className="mobile-time-picker__display">{display}</div>

        <div className="mobile-time-picker__fields">
          <label>
            <span>Hora</span>
            <select value={hour} onChange={(event) => setHour(event.target.value)} autoFocus>
              {HOURS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <strong aria-hidden="true">:</strong>
          <label>
            <span>Minutos</span>
            <select value={minute} onChange={(event) => setMinute(event.target.value)}>
              {MINUTES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <footer className="mobile-time-picker__actions">
          <button className="button button--secondary" type="button" onClick={() => applyValue('')}>Borrar</button>
          <button className="button button--secondary" type="button" onClick={() => setTarget(null)}>Cancelar</button>
          <button className="button button--primary" type="button" onClick={() => applyValue(`${hour}:${minute}`)}>Establecer</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
