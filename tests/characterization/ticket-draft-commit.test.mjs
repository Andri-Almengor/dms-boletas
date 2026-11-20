import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manager = await readFile(new URL('../../src/components/offline/FormRecoveryManager.jsx', import.meta.url), 'utf8');
const persistence = await readFile(new URL('../../src/features/tickets/useTicketPersistence.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../../src/pages/tickets/TicketFormPage.jsx', import.meta.url), 'utf8');

// La clave del recuperador global incluye query string (por ejemplo agendaId).
assert.match(page, /recoveryRoute: `\$\{location\.pathname\}\$\{location\.search\}`/);
// No borrar antes de cancelar la captura y de esperar los guardados pendientes.
assert.match(manager, /committedKeyRef\.current === draftKey\) return;/);
assert.match(manager, /committedKeyRef\.current === keyRef\.current/);
assert.match(manager, /saveGenerationRef\.current \+= 1/);
assert.match(manager, /generation === saveGenerationRef\.current \? saveDraft\(entry\) : null/);
assert.match(manager, /savingRef\.current\.catch\(\(\) => \{\}\)\.then\(\(\) => deleteDraft\(committedKey\)\)/);
assert.match(manager, /event\.detail\.cleanup = cleanup/);
assert.match(manager, /addEventListener\('dms-form-draft-committed', onDraftCommitted\)/);
assert.match(manager, /removeEventListener\('dms-form-draft-committed', onDraftCommitted\)/);

// Ejercitar la acción de guardar sin montar React. La implementación real
// mantiene el orden: backend -> borrador controlado -> recuperador -> navegación.
const executable = persistence
  .replace(/^import[\s\S]*?;\s*$/gm, '')
  .replace('export default function useTicketPersistence(', 'function useTicketPersistence(');
const factory = new Function('deps', `
  const {
    useCallback, useEffect, useRef, useState, useAuth, deleteDraft, isAbortError,
    createLocalId, releaseLocalFiles, validateTicketForm, autosaveTicket,
    runTicketPostSaveAction, saveTicketBase, window, CustomEvent,
  } = deps;
  ${executable}
  return useTicketPersistence;
`);

function harness({ managerPresent = true, fail = false } = {}) {
  const calls = [];
  let completeGlobalCleanup;
  const globalCleanup = new Promise((resolve) => { completeGlobalCleanup = resolve; });
  const useTicketPersistence = factory({
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (initial) => [initial, () => {}],
    useAuth: () => ({ user: { UsuarioID: 'technician-1' } }),
    deleteDraft: async (key) => { calls.push('delete:' + key); },
    isAbortError: () => false,
    createLocalId: () => 'ticket-uid-1',
    releaseLocalFiles: () => calls.push('release-files'),
    validateTicketForm: () => '',
    autosaveTicket: async () => {},
    saveTicketBase: async () => { calls.push('save-backend'); return 'ticket-uid-1'; },
    runTicketPostSaveAction: async () => {
      calls.push('post-save');
      if (fail) throw new Error('Error guardando');
    },
    window: {
      dispatchEvent(event) {
        calls.push('commit:' + event.detail.key);
        if (managerPresent) event.detail.cleanup = globalCleanup;
      },
    },
    CustomEvent: class {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    },
  });
  const hook = useTicketPersistence({
    editing: false,
    loading: false,
    boletaUid: '',
    form: { titulo: 'Boleta de prueba', firma: '' },
    evidences: [],
    sessionToken: 'session',
    clearDraft: async () => { calls.push('clear-controlled'); },
    navigate: (to) => { calls.push('navigate:' + to); },
    navigationState: undefined,
    recoveryRoute: '/boletas/nueva?agendaId=abc',
    setError: (error) => { if (error) calls.push('error:' + error); },
  });
  return { calls, hook, completeGlobalCleanup };
}

{
  const { calls, hook, completeGlobalCleanup } = harness();
  const pending = hook.action('save');
  for (let attempt = 0; attempt < 20 && !calls.some((item) => item.startsWith('commit:')); attempt += 1) {
    await Promise.resolve();
  }
  assert.deepEqual(calls.filter((item) => item.startsWith('commit:')), ['commit:technician-1:/boletas/nueva?agendaId=abc']);
  assert.equal(calls.some((item) => item.startsWith('navigate:')), false, 'No navegar mientras el recuperador global sigue borrando');
  completeGlobalCleanup();
  assert.equal(await pending, 'ticket-uid-1');
  assert.deepEqual(calls.slice(0, 4), [
    'save-backend', 'post-save', 'release-files', 'clear-controlled',
  ]);
  assert.equal(calls.at(-1), 'navigate:/boletas/ticket-uid-1');
}
{
  const { calls, hook } = harness({ managerPresent: false });
  assert.equal(await hook.action('save'), 'ticket-uid-1');
  assert.ok(calls.includes('delete:technician-1:/boletas/nueva?agendaId=abc'), 'Sin recuperador montado también se limpia');
  assert.equal(calls.at(-1), 'navigate:/boletas/ticket-uid-1');
}
{
  const { calls, hook } = harness({ fail: true });
  assert.equal(await hook.action('save'), null);
  assert.equal(calls.some((item) => item.startsWith('commit:')), false, 'Un fallo nunca descarta el borrador');
  assert.equal(calls.some((item) => item.startsWith('navigate:')), false);
  assert.equal(calls.some((item) => item.startsWith('clear-controlled')), false);
}

console.log('ticket draft commit regression passed');
