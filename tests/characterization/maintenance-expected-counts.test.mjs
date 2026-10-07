import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  expectedMaintenanceTotal,
  shadowedMaintenanceCountKeys,
} from '../../src/features/maintenance/maintenanceFormDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el total esperado ignora aliases históricos ocultos de tipos ya canónicos', () => {
  const counts = {
    'CantCámaras': 28,
    'CantGrabadores': 1,
    'CantPuertas': 16,
    'TipoDispositivo:controladora': 1,
    'TipoDispositivo:interfaz': 3,
    'TipoDispositivo:panel': 5,
    // Valor histórico duplicado que antes elevaba 54 a 66.
    'TipoDispositivo:camera-type': 12,
  };
  const devices = [
    { categoria: 'Cámara', tipoDispositivoId: 'camera-type' },
    { categoria: 'Puertas', tipoDispositivoId: 'door-type' },
    { categoria: 'Grabador', tipoDispositivoId: 'recorder-type' },
    { categoria: 'Controladora', tipoDispositivoId: 'controladora' },
    { categoria: 'Interfaz', tipoDispositivoId: 'interfaz' },
    { categoria: 'Panel', tipoDispositivoId: 'panel' },
  ];

  assert.equal(
    Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0),
    66,
  );
  assert.ok(shadowedMaintenanceCountKeys(devices).has('TipoDispositivo:camera-type'));
  assert.equal(expectedMaintenanceTotal(counts, devices), 54);
});

test('al guardar una edición el backend elimina aliases duplicados de CantidadesJSON', () => {
  const module = source('backend/src/modules/maintenance.module.js');
  const form = source('src/hooks/useMaintenanceForm.js');

  assert.match(module, /function sanitizeMaintenanceCounts\(counts = \{\}, devices = \[\]\)/);
  assert.match(module, /delete cleaned\[\`TipoDispositivo:\$\{typeId\}\`\]/);
  assert.match(module, /payload\.CantidadesJSON = JSON\.stringify\(sanitizedCounts\)/);
  assert.match(module, /tables\.Evidencia_Mantenimientos/);
  assert.match(form, /expectedMaintenanceTotal\(form\.counts, devices\)/);
});
