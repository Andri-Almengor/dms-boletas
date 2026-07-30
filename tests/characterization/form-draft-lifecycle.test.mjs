import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shared = await readFile(new URL('../../src/hooks/useFormDraft.js', import.meta.url), 'utf8');
const ticket = await readFile(new URL('../../src/hooks/useTicketDraft.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../../src/services/draftStore.js', import.meta.url), 'utf8');

assert.match(shared, /export function controlledDraftKey/);
assert.match(shared, /loadDraft\(storageKey\)/);
assert.match(shared, /saveDraftBackup\(entry\)/);
assert.match(shared, /saveChainRef\.current/);
assert.match(shared, /pagehide/);
assert.match(shared, /beforeunload/);
assert.match(shared, /deleteDraft\(storageKey\)/);
assert.match(shared, /localStorage\.removeItem\(legacyKey\)/);
assert.match(shared, /cancelledKeyRef\.current === storageKey/);

assert.match(ticket, /useFormDraft/);
assert.match(ticket, /namespace: 'ticket-state'/);
assert.match(ticket, /routePrefix: 'ticket-hook'/);
assert.match(ticket, /dms_boleta_draft_/);
assert.match(ticket, /todayInCostaRica/);
assert.doesNotMatch(ticket, /saveChainRef/);
assert.doesNotMatch(ticket, /saveDraftBackup/);
assert.doesNotMatch(ticket, /beforeunload/);

assert.match(store, /const DB_NAME = 'dms-boletas-form-drafts'/);
assert.match(store, /mergeDraftSources/);
assert.match(store, /MAX_DRAFT_AGE_MS/);

console.log('shared form draft lifecycle characterization passed');
