import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const DRAFT_PREFIX = 'dms_boleta_draft_v1:';
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isBoletaFormPath(pathname) {
  return pathname === '/boletas/nueva' || /^\/boletas\/[^/]+\/editar$/.test(pathname);
}

function getDraftKey(pathname, userId) {
  return `${DRAFT_PREFIX}${userId || 'anon'}:${pathname}`;
}

function readFormSnapshot() {
  const form = document.querySelector('main form');
  if (!form) return null;

  const values = {};
  form.querySelectorAll('input[name], select[name], textarea[name]').forEach((element) => {
    if (!element.name || element.type === 'file' || element.type === 'password') return;

    if (element instanceof HTMLSelectElement && element.multiple) {
      values[element.name] = Array.from(element.selectedOptions).map((option) => option.value);
      return;
    }

    if (element.type === 'checkbox') {
      values[element.name] = Boolean(element.checked);
      return;
    }

    values[element.name] = element.value;
  });

  return values;
}

function setNativeValue(element, value) {
  if (element instanceof HTMLSelectElement) {
    if (element.multiple && Array.isArray(value)) {
      const selected = new Set(value.map(String));
      Array.from(element.options).forEach((option) => {
        option.selected = selected.has(String(option.value));
      });
    } else {
      element.value = value == null ? '' : String(value);
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (element.type === 'checkbox') {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    descriptor?.set?.call(element, Boolean(value));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value == null ? '' : String(value));
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  Object.entries(snapshot).forEach(([name, value]) => {
    const element = document.querySelector(`main form [name="${CSS.escape(name)}"]`);
    if (element) setNativeValue(element, value);
  });
}

export default function BoletaDraftAutosave() {
  const location = useLocation();
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const saveTimerRef = useRef(null);
  const previousPathRef = useRef(location.pathname);

  const active = isBoletaFormPath(location.pathname);
  const draftKey = useMemo(
    () => getDraftKey(location.pathname, user?.UsuarioID),
    [location.pathname, user?.UsuarioID],
  );

  useEffect(() => {
    const previousPath = previousPathRef.current;
    const leftFormAfterSave = isBoletaFormPath(previousPath)
      && !isBoletaFormPath(location.pathname)
      && location.pathname.startsWith('/boletas/');

    if (leftFormAfterSave) {
      localStorage.removeItem(getDraftKey(previousPath, user?.UsuarioID));
    }

    previousPathRef.current = location.pathname;
  }, [location.pathname, user?.UsuarioID]);

  useEffect(() => {
    if (!active || !user?.UsuarioID) return undefined;

    let parsedDraft = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        parsedDraft = JSON.parse(raw);
        if (!parsedDraft.savedAt || Date.now() - parsedDraft.savedAt > MAX_DRAFT_AGE_MS) {
          localStorage.removeItem(draftKey);
          parsedDraft = null;
        }
      }
    } catch {
      localStorage.removeItem(draftKey);
    }

    if (parsedDraft?.values) {
      const restore = window.confirm(
        'Se encontró un borrador guardado automáticamente para esta boleta. ¿Desea recuperarlo?',
      );
      if (restore) {
        [250, 900, 1800, 3200].forEach((delay) => {
          window.setTimeout(() => applySnapshot(parsedDraft.values), delay);
        });
        setStatus('Borrador recuperado.');
      } else {
        localStorage.removeItem(draftKey);
      }
    }

    function scheduleSave() {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        const values = readFormSnapshot();
        if (!values) return;
        localStorage.setItem(draftKey, JSON.stringify({
          values,
          savedAt: Date.now(),
          pathname: location.pathname,
          userId: user.UsuarioID,
        }));
        setStatus(`Borrador guardado: ${new Date().toLocaleTimeString()}`);
      }, 700);
    }

    document.addEventListener('input', scheduleSave, true);
    document.addEventListener('change', scheduleSave, true);

    return () => {
      document.removeEventListener('input', scheduleSave, true);
      document.removeEventListener('change', scheduleSave, true);
      window.clearTimeout(saveTimerRef.current);
    };
  }, [active, draftKey, location.pathname, user?.UsuarioID]);

  if (!active) return null;

  return (
    <aside aria-live="polite">
      <small>{status || 'Autoguardado local activo.'}</small>{' '}
      <button
        type="button"
        onClick={() => {
          localStorage.removeItem(draftKey);
          setStatus('Borrador local eliminado.');
        }}
      >
        Descartar borrador
      </button>
    </aside>
  );
}
