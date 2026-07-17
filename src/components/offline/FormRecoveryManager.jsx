import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { deleteDraft, loadDraft, pruneDrafts, requestPersistentStorage, saveDraft } from '../../services/draftStore';
import Icon from '../common/Icon';

const SAVE_DELAY_MS = 300;
const EDITING_IDLE_MS = 6_000;
const RESTORE_RETRY_MS = 140;
const RESTORE_RETRIES = 45;

const ELIGIBLE_PATH = /^(\/boletas|\/mantenimientos|\/conocimiento|\/clientes|\/catalogos|\/usuarios|\/firmar\/)/;
const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const SKIPPED_INPUT_TYPES = new Set(['password', 'submit', 'button', 'reset', 'image']);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizedPath(pathname, search) {
  return `${pathname}${search || ''}`;
}

function isEligible(pathname) {
  return ELIGIBLE_PATH.test(pathname) && pathname !== '/boletas/pendientes' && pathname !== '/boletas/finalizadas';
}

function formLabel(element) {
  const field = element.closest('.field-group');
  const explicit = field?.querySelector('.field-label')?.textContent;
  const direct = element.closest('label')?.querySelector('.field-label')?.textContent
    || element.closest('label')?.textContent;
  const placeholder = element.getAttribute('placeholder');
  return clean(explicit || direct || placeholder || element.getAttribute('aria-label') || 'campo');
}

function elementIndex(element, selector) {
  return Array.from(document.querySelectorAll(selector)).indexOf(element);
}

function controlKey(element) {
  const explicit = element.dataset?.draftKey || element.getAttribute('name') || element.id;
  if (explicit) return `control:${explicit}`;
  const tag = element.tagName.toLowerCase();
  const type = tag === 'input' ? String(element.type || 'text').toLowerCase() : tag;
  return `control:${formLabel(element)}:${tag}:${type}:${elementIndex(element, CONTROL_SELECTOR)}`;
}

function fileKey(element) {
  const explicit = element.dataset?.draftKey || element.getAttribute('name') || element.id;
  if (explicit) return `file:${explicit}`;
  const root = element.closest('.evidence-uploader, .maintenance-image-section, .knowledge-file-drop, .ticket-evidence-add, label');
  const rootText = clean(root?.querySelector('strong')?.textContent || root?.textContent || 'archivos');
  return `file:${rootText}:${elementIndex(element, 'input[type="file"]')}`;
}

function choiceKey(group) {
  const label = clean(group.closest('.field-group')?.querySelector('.field-label')?.textContent || group.previousElementSibling?.textContent || 'opción');
  return `choice:${label}:${elementIndex(group, '.maintenance-choice')}`;
}

function nativeSetter(element, property, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property)
    || Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
  if (descriptor?.set) descriptor.set.call(element, value);
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
  const buttons = Array.from(actions.querySelectorAll('button'));
  const wanted = direction > 0 ? /siguiente/i : /anterior/i;
  const button = buttons.find((item) => wanted.test(clean(item.textContent)) && !item.disabled);
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
  if (!button) return false;
  return /guardar|finalizar|crear|enviar|registrar firma|guardar cambios/i.test(clean(button.textContent));
}

function hasRecoverableData(data) {
  return Boolean(
    Object.keys(data?.fields || {}).length
    || Object.keys(data?.files || {}).length
    || Object.keys(data?.choices || {}).length
    || data?.signature,
  );
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
  const dataRef = useRef({ fields: {}, files: {}, choices: {}, step: 0, signature: '' });
  const timerRef = useRef(0);
  const releaseTimerRef = useRef(0);
  const savingRef = useRef(Promise.resolve());
  const pendingSubmitRef = useRef(false);
  const restoredFilesRef = useRef(new Set());
  const restorationRef = useRef({ active: false, attempts: 0 });
  const routeRef = useRef(route);
  const keyRef = useRef(draftKey);

  const captureVisible = useCallback(() => {
    const next = {
      ...dataRef.current,
      fields: { ...(dataRef.current.fields || {}) },
      files: { ...(dataRef.current.files || {}) },
      choices: { ...(dataRef.current.choices || {}) },
      step: readCurrentStep() || dataRef.current.step || 0,
    };

    document.querySelectorAll(CONTROL_SELECTOR).forEach((element) => {
      if (!(element instanceof HTMLElement) || element.closest('[data-no-draft]')) return;
      const tag = element.tagName.toLowerCase();
      const type = tag === 'input' ? String(element.type || 'text').toLowerCase() : tag;
      if (SKIPPED_INPUT_TYPES.has(type) || type === 'file') return;
      const key = controlKey(element);
      if (type === 'checkbox' || type === 'radio') {
        next.fields[key] = { type, checked: Boolean(element.checked), value: element.value || '' };
      } else if (element.isContentEditable) {
        next.fields[key] = { type: 'contenteditable', value: element.textContent || '' };
      } else {
        next.fields[key] = { type, value: element.value ?? '' };
      }
    });

    document.querySelectorAll('.maintenance-choice').forEach((group) => {
      const selected = group.querySelector('button.is-selected');
      if (selected) next.choices[choiceKey(group)] = clean(selected.textContent);
    });

    dataRef.current = next;
    return next;
  }, []);

  const persistNow = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled) return null;
    const data = captureVisible();
    if (!hasRecoverableData(data)) return null;
    if (!quiet) setStatus('saving');
    const entry = {
      key: keyRef.current,
      route: routeRef.current,
      userScope: scope,
      data,
    };
    savingRef.current = savingRef.current
      .catch(() => {})
      .then(() => saveDraft(entry));
    try {
      const saved = await savingRef.current;
      setStatus('local');
      window.dispatchEvent(new CustomEvent('dms-form-draft-saved', {
        detail: { key: entry.key, route: entry.route, savedAt: saved.updatedAt },
      }));
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dms-offline-editing-complete', {
          detail: { source: 'form-draft', key: entry.key },
        }));
        if (status !== 'restored') setStatus('idle');
      }, EDITING_IDLE_MS);
      return saved;
    } catch (error) {
      setStatus('error');
      setNotice('No fue posible guardar el borrador local. Mantenga esta pantalla abierta hasta guardar manualmente.');
      return null;
    }
  }, [captureVisible, enabled, scope, status]);

  const scheduleSave = useCallback(() => {
    if (!enabled || restorationRef.current.active) return;
    window.clearTimeout(timerRef.current);
    setStatus('saving');
    timerRef.current = window.setTimeout(() => persistNow(), SAVE_DELAY_MS);
  }, [enabled, persistNow]);

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
      if (!wanted) return;
      const current = clean(group.querySelector('button.is-selected')?.textContent);
      if (current === wanted) return;
      const button = Array.from(group.querySelectorAll('button')).find((item) => clean(item.textContent) === wanted && !item.disabled);
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
        nativeSetter(input, 'files', transfer.files);
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
    if (targetStep && currentStep && targetStep !== currentStep) {
      clickStepButton(targetStep > currentStep ? 1 : -1);
    }

    if (restorationRef.current.attempts < RESTORE_RETRIES) {
      window.setTimeout(restoreLoop, RESTORE_RETRY_MS);
      return;
    }
    restorationRef.current.active = false;
    setStatus('restored');
    setNotice('Se recuperó el trabajo que estaba guardado en este dispositivo.');
    window.setTimeout(() => setStatus('idle'), 5_000);
  }, [restoreControls]);

  useEffect(() => {
    routeRef.current = route;
    keyRef.current = draftKey;
    dataRef.current = { fields: {}, files: {}, choices: {}, step: 0, signature: '' };
    restoredFilesRef.current = new Set();
    restorationRef.current = { active: false, attempts: 0 };
    setStatus('idle');
    setNotice('');
    if (!enabled) return undefined;

    let active = true;
    requestPersistentStorage().catch(() => {});
    pruneDrafts().catch(() => {});
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
      window.setTimeout(restoreLoop, RESTORE_RETRY_MS);
    }).catch(() => {});

    return () => {
      active = false;
      window.clearTimeout(timerRef.current);
      window.clearTimeout(releaseTimerRef.current);
      persistNow({ quiet: true }).catch(() => {});
      if (pendingSubmitRef.current) deleteDraft(draftKey).catch(() => {});
    };
  }, [draftKey, enabled, persistNow, restoreLoop, route]);

  useEffect(() => {
    if (!enabled) return undefined;

    const markChanged = (event) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-no-draft]')) return;
      if (!event.target.matches(CONTROL_SELECTOR) && !event.target.closest('.maintenance-choice, .signature-pad')) return;
      if (event.target.matches('input[type="password"]')) return;
      if (event.target.matches('input[type="file"]')) {
        const key = fileKey(event.target);
        const files = Array.from(event.target.files || []);
        if (files.length) {
          dataRef.current = {
            ...dataRef.current,
            files: {
              ...(dataRef.current.files || {}),
              [key]: mergeFiles(dataRef.current.files?.[key] || [], files),
            },
          };
        }
      }
      pendingSubmitRef.current = false;
      scheduleSave();
    };

    const captureSignature = (event) => {
      if (event.detail?.route && event.detail.route !== routeRef.current) return;
      dataRef.current = { ...dataRef.current, signature: event.detail?.value || '' };
      scheduleSave();
    };

    const markSubmit = () => {
      pendingSubmitRef.current = true;
      persistNow({ quiet: true }).catch(() => {});
      window.setTimeout(() => { pendingSubmitRef.current = false; }, 30_000);
    };

    const markClick = (event) => {
      if (isSaveAction(event.target)) markSubmit();
      if (event.target instanceof Element && event.target.closest('.maintenance-choice')) {
        window.setTimeout(scheduleSave, 0);
      }
    };

    const flush = () => persistNow({ quiet: true }).catch(() => {});

    document.addEventListener('input', markChanged, true);
    document.addEventListener('change', markChanged, true);
    document.addEventListener('click', markClick, true);
    document.addEventListener('submit', markSubmit, true);
    window.addEventListener('dms-signature-draft-change', captureSignature);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', visibility);

    const observer = new MutationObserver(() => {
      if (restorationRef.current.active) restoreControls();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.removeEventListener('input', markChanged, true);
      document.removeEventListener('change', markChanged, true);
      document.removeEventListener('click', markClick, true);
      document.removeEventListener('submit', markSubmit, true);
      window.removeEventListener('dms-signature-draft-change', captureSignature);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, persistNow, restoreControls, scheduleSave]);

  async function discardDraft() {
    await deleteDraft(draftKey).catch(() => {});
    dataRef.current = { fields: {}, files: {}, choices: {}, step: 0, signature: '' };
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
