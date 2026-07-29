import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import {
  deleteDraft,
  loadDraft,
  pruneDrafts,
  requestPersistentStorage,
  saveDraft,
  saveDraftBackup,
} from '../../services/draftStore';
import Icon from '../common/Icon';

const SAVE_DELAY_MS = 700;
const EDITING_IDLE_MS = 6_000;
const RESTORE_RETRY_MS = 200;
const RESTORE_RETRIES = 30;
const ELIGIBLE_PATH = /^(\/boletas|\/mantenimientos|\/conocimiento|\/clientes|\/catalogos|\/usuarios|\/firmar\/)/;
const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const SKIPPED_INPUT_TYPES = new Set(['password', 'submit', 'button', 'reset', 'image']);
const preparedScopes = new Set();

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function runIdle(callback, timeout = 1_500) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }
  return window.setTimeout(callback, Math.min(timeout, 500));
}

function normalizedPath(pathname, search) {
  return `${pathname}${search || ''}`;
}

function isEligible(pathname) {
  return ELIGIBLE_PATH.test(pathname)
    && pathname !== '/boletas/pendientes'
    && pathname !== '/boletas/finalizadas'
    && pathname !== '/mantenimientos'
    && pathname !== '/conocimiento'
    && pathname !== '/clientes'
    && pathname !== '/catalogos'
    && pathname !== '/usuarios';
}

function formLabel(element) {
  const field = element.closest('.field-group');
  const explicit = field?.querySelector('.field-label')?.textContent;
  const direct = element.closest('label')?.querySelector('.field-label')?.textContent
    || element.closest('label')?.textContent;
  return clean(explicit || direct || element.getAttribute('placeholder') || element.getAttribute('aria-label') || 'campo');
}

function descriptor(element) {
  const tag = element.tagName.toLowerCase();
  const type = tag === 'input' ? String(element.type || 'text').toLowerCase() : tag;
  return `${formLabel(element)}|${tag}|${type}`;
}

function occurrenceIndex(element, selector, getDescriptor) {
  const wanted = getDescriptor(element);
  return Array.from(document.querySelectorAll(selector))
    .filter((candidate) => getDescriptor(candidate) === wanted)
    .indexOf(element);
}

function controlKey(element) {
  const tag = element.tagName.toLowerCase();
  const type = tag === 'input' ? String(element.type || 'text').toLowerCase() : tag;
  const explicit = element.dataset?.draftKey || element.getAttribute('name') || element.id;
  if (explicit) {
    const option = type === 'checkbox' || type === 'radio' ? `:${element.value || formLabel(element)}` : '';
    return `control:${explicit}:${type}${option}`;
  }
  return `control:${descriptor(element)}:${occurrenceIndex(element, CONTROL_SELECTOR, descriptor)}`;
}

function fileDescriptor(element) {
  const root = element.closest('.evidence-uploader, .maintenance-image-section, .knowledge-file-drop, .ticket-evidence-add, label');
  return clean(root?.querySelector('strong')?.textContent || root?.textContent || 'archivos');
}

function fileKey(element) {
  const explicit = element.dataset?.draftKey || element.getAttribute('name') || element.id;
  if (explicit) return `file:${explicit}`;
  return `file:${fileDescriptor(element)}:${occurrenceIndex(element, 'input[type="file"]', fileDescriptor)}`;
}

function choiceDescriptor(group) {
  return clean(group.closest('.field-group')?.querySelector('.field-label')?.textContent
    || group.previousElementSibling?.textContent
    || 'opción');
}

function choiceKey(group) {
  return `choice:${choiceDescriptor(group)}:${occurrenceIndex(group, '.maintenance-choice', choiceDescriptor)}`;
}

function nativeSetter(element, property, value) {
  const prototypes = [
    Object.getPrototypeOf(element),
    HTMLInputElement.prototype,
    HTMLTextAreaElement.prototype,
    HTMLSelectElement.prototype,
    HTMLElement.prototype,
  ];
  const propertyDescriptor = prototypes
    .map((prototype) => Object.getOwnPropertyDescriptor(prototype, property))
    .find(Boolean);
  if (propertyDescriptor?.set) propertyDescriptor.set.call(element, value);
  else element[property] = value;
}

function emitValueChange(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function readCurrentStep() {
  const text = clean(document.querySelector('.ticket-progress strong')?.textContent);
  const match = text.match(/Paso\s+(\d+)\s+de/i);
  return match ? Number(match[1]) : 0;
}

function clickStepButton(direction) {
  const actions = document.querySelector('.ticket-form-actions');
  if (!actions) return false;
  const wanted = direction > 0 ? /siguiente/i : /anterior/i;
  const button = Array.from(actions.querySelectorAll('button'))
    .find((item) => wanted.test(clean(item.textContent)) && !item.disabled);
  if (!button) return false;
  button.click();
  return true;
}

function fileIdentity(file) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function mergeFiles(existing = [], incoming = []) {
  const map = new Map(existing.map((file) => [fileIdentity(file), file]));
  incoming.forEach((file) => map.set(fileIdentity(file), file));
  return Array.from(map.values());
}

function isSaveAction(target) {
  if (!(target instanceof Element)) return false;
  const button = target.closest('button, [role="button"]');
  return Boolean(button && /guardar|finalizar|enviar|registrar firma|crear boleta|crear mantenimiento|crear visita/i.test(clean(button.textContent)));
}

function hasRecoverableData(data) {
  return Boolean(
    Object.keys(data?.fields || {}).length
      || Object.keys(data?.files || {}).length
      || Object.keys(data?.choices || {}).length
      || data?.signature,
  );
}

function emptyData() {
  return { fields: {}, files: {}, choices: {}, step: 0, signature: '' };
}

export default function FormRecoveryManager() {
  const location = useLocation();
  const { user } = useAuth();
  const route = useMemo(() => normalizedPath(location.pathname, location.search), [location.pathname, location.search]);
  const scope = String(user?.UsuarioID || user?.Correo || 'public');
  const draftKey = useMemo(() => `${scope}:${route}`, [scope, route]);
  const enabled = isEligible(location.pathname);
  const [status, setStatus] = useState('idle');
  const [notice, setNotice] = useState('');
  const dataRef = useRef(emptyData());
  const timerRef = useRef(0);
  const releaseTimerRef = useRef(0);
  const restoreTimerRef = useRef(0);
  const submitResetTimerRef = useRef(0);
  const savingRef = useRef(Promise.resolve());
  const pendingSubmitRef = useRef(false);
  const restoredFilesRef = useRef(new Set());
  const restorationRef = useRef({ active: false, attempts: 0 });
  const routeRef = useRef(route);
  const keyRef = useRef(draftKey);
  const scopeRef = useRef(scope);

  const currentEntry = useCallback((data = dataRef.current) => ({
    key: keyRef.current,
    route: routeRef.current,
    userScope: scopeRef.current,
    data,
  }), []);

  const backupCurrent = useCallback(() => {
    if (!enabled || !hasRecoverableData(dataRef.current)) return null;
    return saveDraftBackup(currentEntry());
  }, [currentEntry, enabled]);

  const captureControl = useCallback((element) => {
    if (!(element instanceof HTMLElement) || element.closest('[data-no-draft]')) return false;
    if (!element.matches(CONTROL_SELECTOR)) return false;
    const tag = element.tagName.toLowerCase();
    const type = tag === 'input' ? String(element.type || 'text').toLowerCase() : tag;
    if (SKIPPED_INPUT_TYPES.has(type) || type === 'file') return false;
    const key = controlKey(element);
    const fields = { ...(dataRef.current.fields || {}) };
    if (type === 'checkbox' || type === 'radio') {
      fields[key] = { type, checked: Boolean(element.checked), value: element.value || '' };
    } else if (element.isContentEditable) {
      fields[key] = { type: 'contenteditable', value: element.textContent || '' };
    } else {
      fields[key] = { type, value: element.value ?? '' };
    }
    dataRef.current = { ...dataRef.current, fields, step: readCurrentStep() || dataRef.current.step || 0 };
    return true;
  }, []);

  const captureChoice = useCallback((group) => {
    if (!(group instanceof Element)) return false;
    const selected = group.querySelector('button.is-selected');
    if (!selected) return false;
    dataRef.current = {
      ...dataRef.current,
      choices: { ...(dataRef.current.choices || {}), [choiceKey(group)]: clean(selected.textContent) },
      step: readCurrentStep() || dataRef.current.step || 0,
    };
    return true;
  }, []);

  const captureVisible = useCallback(() => {
    document.querySelectorAll(CONTROL_SELECTOR).forEach(captureControl);
    document.querySelectorAll('.maintenance-choice').forEach(captureChoice);
    dataRef.current = { ...dataRef.current, step: readCurrentStep() || dataRef.current.step || 0 };
    return dataRef.current;
  }, [captureChoice, captureControl]);

  const persistNow = useCallback(async ({ quiet = false, fullCapture = true } = {}) => {
    if (!enabled) return null;
    if (fullCapture) captureVisible();
    if (!hasRecoverableData(dataRef.current)) return null;
    if (!quiet) setStatus('saving');
    const entry = currentEntry();
    saveDraftBackup(entry);
    savingRef.current = savingRef.current.catch(() => {}).then(() => saveDraft(entry));
    try {
      const saved = await savingRef.current;
      setStatus('local');
      setNotice('');
      window.dispatchEvent(new CustomEvent('dms-form-draft-saved', {
        detail: { key: entry.key, route: entry.route, savedAt: saved.updatedAt },
      }));
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dms-offline-editing-complete', {
          detail: { source: 'form-draft', key: entry.key },
        }));
        setStatus('idle');
      }, EDITING_IDLE_MS);
      return saved;
    } catch {
      setStatus('error');
      setNotice('No fue posible guardar el borrador local. Mantenga esta pantalla abierta hasta guardar manualmente.');
      return null;
    }
  }, [captureVisible, currentEntry, enabled]);

  const scheduleSave = useCallback(() => {
    if (!enabled || restorationRef.current.active) return;
    window.clearTimeout(timerRef.current);
    setStatus('saving');
    backupCurrent();
    timerRef.current = window.setTimeout(() => persistNow({ fullCapture: false }), SAVE_DELAY_MS);
  }, [backupCurrent, enabled, persistNow]);

  const restoreControls = useCallback(() => {
    const data = dataRef.current;
    let changed = false;
    document.querySelectorAll(CONTROL_SELECTOR).forEach((element) => {
      if (!(element instanceof HTMLElement) || element.closest('[data-no-draft]')) return;
      const tag = element.tagName.toLowerCase();
      const type = tag === 'input' ? String(element.type || 'text').toLowerCase() : tag;
      if (SKIPPED_INPUT_TYPES.has(type) || type === 'file') return;
      const saved = data.fields?.[controlKey(element)];
      if (!saved) return;
      if (type === 'checkbox' || type === 'radio') {
        if (Boolean(element.checked) !== Boolean(saved.checked)) {
          nativeSetter(element, 'checked', Boolean(saved.checked));
          emitValueChange(element);
          changed = true;
        }
      } else if (element.isContentEditable) {
        if (element.textContent !== saved.value) {
          element.textContent = saved.value || '';
          emitValueChange(element);
          changed = true;
        }
      } else if (String(element.value ?? '') !== String(saved.value ?? '')) {
        nativeSetter(element, 'value', saved.value ?? '');
        emitValueChange(element);
        changed = true;
      }
    });

    document.querySelectorAll('.maintenance-choice').forEach((group) => {
      const wanted = data.choices?.[choiceKey(group)];
      if (!wanted || clean(group.querySelector('button.is-selected')?.textContent) === wanted) return;
      const button = Array.from(group.querySelectorAll('button'))
        .find((item) => clean(item.textContent) === wanted && !item.disabled);
      if (button) {
        button.click();
        changed = true;
      }
    });

    document.querySelectorAll('input[type="file"]').forEach((input) => {
      const key = fileKey(input);
      const files = data.files?.[key] || [];
      if (!files.length || restoredFilesRef.current.has(key)) return;
      try {
        const transfer = new DataTransfer();
        files.forEach((file) => transfer.items.add(file));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        restoredFilesRef.current.add(key);
        changed = true;
      } catch {
        window.dispatchEvent(new CustomEvent('dms-draft-restore-files', {
          detail: { key, files, route: routeRef.current },
        }));
      }
    });

    if (data.signature) {
      window.dispatchEvent(new CustomEvent('dms-draft-restore-signature', {
        detail: { route: routeRef.current, value: data.signature },
      }));
    }
    return changed;
  }, []);

  const restoreLoop = useCallback(() => {
    if (!restorationRef.current.active) return;
    restorationRef.current.attempts += 1;
    restoreControls();
    const targetStep = Number(dataRef.current.step || 0);
    const currentStep = readCurrentStep();
    if (targetStep && currentStep && targetStep !== currentStep) clickStepButton(targetStep > currentStep ? 1 : -1);

    if (restorationRef.current.attempts < RESTORE_RETRIES) {
      restoreTimerRef.current = window.setTimeout(restoreLoop, RESTORE_RETRY_MS);
      return;
    }
    restorationRef.current.active = false;
    setStatus('restored');
    setNotice('Se recuperó el trabajo que estaba guardado en este dispositivo.');
    window.setTimeout(() => setStatus('idle'), 5_000);
  }, [restoreControls]);

  useEffect(() => {
    if (!scope || preparedScopes.has(scope)) return undefined;
    preparedScopes.add(scope);
    const task = runIdle(() => {
      requestPersistentStorage().catch(() => {});
      pruneDrafts().catch(() => {});
    });
    return () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(task);
      else window.clearTimeout(task);
    };
  }, [scope]);

  useEffect(() => {
    routeRef.current = route;
    keyRef.current = draftKey;
    scopeRef.current = scope;
    dataRef.current = emptyData();
    restoredFilesRef.current = new Set();
    restorationRef.current = { active: false, attempts: 0 };
    pendingSubmitRef.current = false;
    setStatus('idle');
    setNotice('');
    if (!enabled) return undefined;

    let active = true;
    loadDraft(draftKey).then((entry) => {
      if (!active || !entry?.data || !hasRecoverableData(entry.data)) return;
      dataRef.current = {
        fields: entry.data.fields || {},
        files: entry.data.files || {},
        choices: entry.data.choices || {},
        step: Number(entry.data.step || 0),
        signature: entry.data.signature || '',
      };
      restorationRef.current = { active: true, attempts: 0 };
      setStatus('restored');
      setNotice('Recuperando el trabajo guardado automáticamente...');
      restoreTimerRef.current = window.setTimeout(restoreLoop, RESTORE_RETRY_MS);
    }).catch(() => {});

    return () => {
      active = false;
      window.clearTimeout(timerRef.current);
      window.clearTimeout(releaseTimerRef.current);
      window.clearTimeout(restoreTimerRef.current);
      window.clearTimeout(submitResetTimerRef.current);
      restorationRef.current.active = false;
      if (pendingSubmitRef.current) {
        savingRef.current.catch(() => {}).then(() => deleteDraft(draftKey)).catch(() => {});
      } else {
        captureVisible();
        if (hasRecoverableData(dataRef.current)) {
          const entry = { key: draftKey, route, userScope: scope, data: dataRef.current };
          saveDraftBackup(entry);
          savingRef.current.catch(() => {}).then(() => saveDraft(entry)).catch(() => {});
        }
      }
    };
  }, [captureVisible, draftKey, enabled, restoreLoop, route, scope]);

  useEffect(() => {
    if (!enabled) return undefined;

    const markChanged = (event) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-no-draft]')) return;
      if (event.target.matches('input[type="password"]')) return;
      pendingSubmitRef.current = false;

      if (event.target.matches('input[type="file"]')) {
        const key = fileKey(event.target);
        const files = Array.from(event.target.files || []);
        if (files.length) {
          dataRef.current = {
            ...dataRef.current,
            files: { ...(dataRef.current.files || {}), [key]: mergeFiles(dataRef.current.files?.[key] || [], files) },
          };
          backupCurrent();
          persistNow({ quiet: true, fullCapture: false }).catch(() => {});
        }
        return;
      }

      const control = event.target.matches(CONTROL_SELECTOR) ? event.target : event.target.closest(CONTROL_SELECTOR);
      if (control && captureControl(control)) scheduleSave();
    };

    const captureSignature = (event) => {
      if (event.detail?.route && event.detail.route !== routeRef.current) return;
      dataRef.current = { ...dataRef.current, signature: event.detail?.value || '' };
      backupCurrent();
      persistNow({ quiet: true, fullCapture: false }).catch(() => {});
    };

    const markSubmit = () => {
      pendingSubmitRef.current = true;
      captureVisible();
      backupCurrent();
      persistNow({ quiet: true, fullCapture: false }).catch(() => {});
      window.clearTimeout(submitResetTimerRef.current);
      submitResetTimerRef.current = window.setTimeout(() => { pendingSubmitRef.current = false; }, 30_000);
    };

    const markClick = (event) => {
      if (isSaveAction(event.target)) markSubmit();
      const group = event.target instanceof Element ? event.target.closest('.maintenance-choice') : null;
      if (group) {
        window.setTimeout(() => {
          if (captureChoice(group)) scheduleSave();
        }, 0);
      }
    };

    const flush = () => {
      captureVisible();
      backupCurrent();
      persistNow({ quiet: true, fullCapture: false }).catch(() => {});
    };

    document.addEventListener('input', markChanged, true);
    document.addEventListener('change', markChanged, true);
    document.addEventListener('click', markClick, true);
    document.addEventListener('submit', markSubmit, true);
    window.addEventListener('dms-signature-draft-change', captureSignature);
    window.addEventListener('pagehide', flush);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', visibility);

    return () => {
      document.removeEventListener('input', markChanged, true);
      document.removeEventListener('change', markChanged, true);
      document.removeEventListener('click', markClick, true);
      document.removeEventListener('submit', markSubmit, true);
      window.removeEventListener('dms-signature-draft-change', captureSignature);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [backupCurrent, captureChoice, captureControl, captureVisible, enabled, persistNow, scheduleSave]);

  async function discardDraft() {
    await deleteDraft(draftKey).catch(() => {});
    dataRef.current = emptyData();
    restoredFilesRef.current = new Set();
    setStatus('idle');
    setNotice('');
  }

  if (!enabled || status === 'idle') return null;
  const message = status === 'saving'
    ? 'Guardando cambios en este dispositivo...'
    : status === 'error'
      ? notice
      : notice || 'Los cambios quedaron protegidos en este dispositivo.';

  return (
    <aside className={`form-recovery-status form-recovery-status--${status}`} role="status" aria-live="polite">
      <Icon name={status === 'saving' ? 'sync' : status === 'error' ? 'error' : 'save'} />
      <div>
        <strong>{status === 'saving' ? 'Protegiendo cambios' : status === 'error' ? 'Borrador no guardado' : 'Borrador recuperado'}</strong>
        <small>{message}</small>
      </div>
      {status === 'restored' && <button type="button" onClick={discardDraft}>Descartar</button>}
    </aside>
  );
}
