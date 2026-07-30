import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shared = await readFile(new URL('../../src/hooks/useFormDraft.js', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../../src/hooks/useMaintenanceDeviceDraft.js', import.meta.url), 'utf8');
const optimized = await readFile(new URL('../../src/hooks/useOptimizedMaintenanceForm.js', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../../src/features/maintenance/useMaintenanceDeviceEditorLifecycle.js', import.meta.url), 'utf8');
const state = await readFile(new URL('../../src/features/maintenance/maintenanceDeviceState.js', import.meta.url), 'utf8');
const formHook = await readFile(new URL('../../src/hooks/useMaintenanceForm.js', import.meta.url), 'utf8');

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

// La escritura histórica permanece temporalmente en el ciclo de edición;
// el adaptador compartido la migra y limpia mediante legacyKeys.
assert.match(state, /dms-maintenance-device-draft:/);
assert.match(state, /MAINTENANCE_DEVICE_DRAFT_DELAY_MS = 650/);
assert.match(lifecycle, /localStorage\.setItem\(draftKey/);
assert.match(lifecycle, /restoreLegacyMaintenanceDevice/);
assert.match(formHook, /useMaintenanceDeviceEditorLifecycle/);
assert.doesNotMatch(formHook, /localStorage\.setItem/);

console.log('maintenance device draft adapter characterization passed');
