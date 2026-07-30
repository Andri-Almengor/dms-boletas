import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shared = await readFile(new URL('../../src/hooks/useFormDraft.js', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../../src/hooks/useMaintenanceDeviceDraft.js', import.meta.url), 'utf8');
const optimized = await readFile(new URL('../../src/hooks/useOptimizedMaintenanceForm.js', import.meta.url), 'utf8');
const legacy = await readFile(new URL('../../src/hooks/useMaintenanceForm.js', import.meta.url), 'utf8');

assert.match(shared, /persistEnabled = enabled/);
assert.match(shared, /!persistEnabled/);
assert.match(shared, /return parsed;/);

assert.match(adapter, /useFormDraft/);
assert.match(adapter, /namespace: 'maintenance-device-state'/);
assert.match(adapter, /routePrefix: 'maintenance-device-hook'/);
assert.match(adapter, /dms-maintenance-device-draft:/);
assert.match(adapter, /saveDelayMs: SAVE_DELAY_MS/);
assert.match(adapter, /newImages: \[\]/);
assert.match(adapter, /consumeRestoredDevice/);
assert.match(adapter, /clearDeviceDraft/);

assert.match(optimized, /useMaintenanceDeviceDraft/);
assert.match(optimized, /draft\.consumeRestoredDevice/);
assert.match(optimized, /draft\.clearDeviceDraft/);
assert.match(optimized, /deviceDraftStorageKey/);
assert.match(optimized, /persistDeviceDraft \? draft\.status : state\.deviceAutosaveStatus/);

// El mecanismo histórico permanece temporalmente como compatibilidad de escritura;
// el adaptador lo migra y lo limpia mediante legacyKeys sin cambiar la clave existente.
assert.match(legacy, /dms-maintenance-device-draft:/);
assert.match(legacy, /LOCAL_DRAFT_DELAY_MS = 650/);

console.log('maintenance device draft adapter characterization passed');
