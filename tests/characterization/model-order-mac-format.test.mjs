import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  formatMacAddressInput,
  isValidMacAddress,
  normalizeMacAddress,
} from '../../src/utils/macAddress.js';
import { sortOptionsNaturally } from '../../src/utils/naturalSort.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('los modelos usan orden alfanumérico natural sin mutar el catálogo original', () => {
  const original = [
    { value: '20', label: 'AX20' },
    { value: '2', label: 'AX2' },
    { value: '10', label: 'AX10' },
    { value: '1', label: 'AX1' },
  ];

  const sorted = sortOptionsNaturally(original);
  assert.deepEqual(sorted.map((item) => item.label), ['AX1', 'AX2', 'AX10', 'AX20']);
  assert.deepEqual(original.map((item) => item.label), ['AX20', 'AX2', 'AX10', 'AX1']);
});

test('la MAC se formatea progresivamente en mayúsculas y con dos puntos', () => {
  assert.equal(formatMacAddressInput('a'), 'A');
  assert.equal(formatMacAddressInput('aab'), 'AA:B');
  assert.equal(formatMacAddressInput('aabbcc'), 'AA:BB:CC');
  assert.equal(formatMacAddressInput('aabbccddeeff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(formatMacAddressInput('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(formatMacAddressInput('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMacAddress('aa bb cc dd ee ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(isValidMacAddress('AA:BB:CC:DD:EE:FF'), true);
  assert.equal(isValidMacAddress('AA:BB:CC'), false);
});

test('boletas y dispositivos de mantenimiento reutilizan el mismo formato MAC y el orden de modelos', () => {
  const dependentSelect = source('src/components/forms/DependentSelect.jsx');
  const formField = source('src/components/forms/FormField.jsx');
  const ticketForm = source('src/pages/tickets/TicketFormPage.jsx');
  const maintenanceEditor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');

  assert.match(dependentSelect, /normalizedLabel === 'modelo'/);
  assert.match(dependentSelect, /sortOptionsNaturally\(options\)/);
  assert.match(dependentSelect, /displayedOptions\.map/);
  assert.match(formField, /formatMacAddressInput/);
  assert.match(formField, /macaddress/);
  assert.match(ticketForm, /name="macAddress"/);
  assert.match(maintenanceEditor, /formatMacAddressInput\(event\.target\.value\)/);
  assert.match(maintenanceEditor, /normalizeMacAddress\(device\.macAddress\)/);
});
