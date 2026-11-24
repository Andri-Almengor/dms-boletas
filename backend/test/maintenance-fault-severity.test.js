import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAINTENANCE_FAULT_SEVERITIES,
  normalizeMaintenanceFaultSeverity,
  maintenanceFaultObservationLength,
  MIN_MAINTENANCE_FAULT_OBSERVATION_LENGTH,
  validateMaintenanceFaultDetails,
} from '../../src/utils/maintenanceFaultSeverity.js';

const faulty = (overrides = {}) => ({
  Estado: 'Mal estado',
  GravedadFalla: 'Moderada',
  Observacion: 'Se detectó pérdida de señal intermitente.',
  ...overrides,
});

test('la clasificación de fallas admite solo Leve, Moderada o Crítica', () => {
  assert.deepEqual(MAINTENANCE_FAULT_SEVERITIES, ['Leve', 'Moderada', 'Crítica']);
  assert.equal(normalizeMaintenanceFaultSeverity('critica'), 'Crítica');
  assert.equal(normalizeMaintenanceFaultSeverity('MODERADA'), 'Moderada');
  assert.equal(normalizeMaintenanceFaultSeverity('Severa'), '');
});

test('estado Mal estado requiere gravedad y 20 caracteres reales de observación', () => {
  assert.equal(validateMaintenanceFaultDetails(faulty()).valid, true);
  assert.equal(validateMaintenanceFaultDetails(faulty({ GravedadFalla: '' })).valid, false);
  assert.match(validateMaintenanceFaultDetails(faulty({ GravedadFalla: 'Grave' })).severityError, /Seleccione/);
  assert.match(validateMaintenanceFaultDetails(faulty({ Observacion: ' Corto ' })).observationError, /20 caracteres/);
  assert.equal(validateMaintenanceFaultDetails(faulty({ Observacion: 'x'.repeat(19) })).valid, false);
  assert.equal(validateMaintenanceFaultDetails(faulty({ Observacion: 'x'.repeat(20) })).valid, true);
  assert.equal(validateMaintenanceFaultDetails(faulty({ Observacion: ' '.repeat(40) })).valid, false);
});

test('no impone nueva regla a dispositivos correctos, pendientes ni proyectos', () => {
  assert.equal(validateMaintenanceFaultDetails({ Estado: 'Correcto' }).valid, true);
  assert.equal(validateMaintenanceFaultDetails({ Estado: 'PENDIENTE' }).valid, true);
  assert.equal(validateMaintenanceFaultDetails(faulty({ GravedadFalla: '', Observacion: '' }), { projectMode: true }).valid, true);
});

test('el contador visual usa la misma longitud que la validación de guardado', () => {
  for (const observation of ['  ', 'Puerta sin Strike', 'x'.repeat(19), 'x'.repeat(20), '  ' + 'á'.repeat(20) + '  ', '😀'.repeat(19), '😀'.repeat(20)]) {
    const count = maintenanceFaultObservationLength(observation);
    const result = validateMaintenanceFaultDetails(faulty({ Observacion: observation }));
    assert.equal(result.valid, count >= MIN_MAINTENANCE_FAULT_OBSERVATION_LENGTH);
    if (!result.valid) assert.ok(result.observationError.includes(`(${count}/20)`));
  }
  assert.equal(maintenanceFaultObservationLength('Puerta sin Strike'), 17);
  assert.equal(maintenanceFaultObservationLength('  😀  '), 1);
});
