import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  formatMaintenanceTicketNumber,
  isMaintenanceGeneratedTicketUid,
  maintenanceTicketSequence,
  nextMaintenanceTicketNumber,
} from '../../backend/src/services/maintenance-ticket-number.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('formatea el consecutivo de mantenimiento como M01, M02 y continúa después de M99', () => {
  assert.equal(formatMaintenanceTicketNumber(1), 'M01');
  assert.equal(formatMaintenanceTicketNumber(2), 'M02');
  assert.equal(formatMaintenanceTicketNumber(9), 'M09');
  assert.equal(formatMaintenanceTicketNumber(10), 'M10');
  assert.equal(formatMaintenanceTicketNumber(99), 'M99');
  assert.equal(formatMaintenanceTicketNumber(100), 'M100');
});

test('calcula el siguiente consecutivo usando solo boletas M existentes', () => {
  const rows = [
    { BoletaID: 147 },
    { BoletaID: '148' },
    { BoletaID: 'M01' },
    { BoletaID: 'M02' },
    { BoletaID: 'M10' },
    { BoletaID: 'OTRO' },
  ];

  assert.equal(maintenanceTicketSequence('M02'), 2);
  assert.equal(maintenanceTicketSequence('m10'), 10);
  assert.equal(maintenanceTicketSequence('148'), 0);
  assert.equal(nextMaintenanceTicketNumber(rows), 'M11');
  assert.equal(nextMaintenanceTicketNumber([{ BoletaID: 300 }]), 'M01');
});

test('solo el UID determinista de boletas generadas por mantenimiento activa la serie M', () => {
  assert.equal(isMaintenanceGeneratedTicketUid('mnt-123456789abc-1234567890abcdef1234'), true);
  assert.equal(isMaintenanceGeneratedTicketUid('mnt-local-user-ticket'), false);
  assert.equal(isMaintenanceGeneratedTicketUid('123456789abc-1234567890abcdef1234'), false);
});

test('la creación de boletas mantiene números normales y usa Mxx solo para mantenimientos', () => {
  const contents = source('backend/src/modules/tickets.module.js');

  assert.match(contents, /isMaintenanceGeneratedTicketUid\(requestedId\)/);
  assert.match(contents, /\? nextMaintenanceTicketNumber\(rows\)/);
  assert.match(contents, /: nextTicketNumber\(rows\)/);
  assert.match(contents, /readTable\('Boletas', \{ force: true \}\)/);
});
