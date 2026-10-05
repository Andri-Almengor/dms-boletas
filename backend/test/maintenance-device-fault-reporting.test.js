import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { tableDefinition } from '../src/config/database-tables.js';

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('maintenance fault migration and runtime catalog persist ReportaAveria', () => {
  const migration = source('../migrations/020_maintenance_device_fault_reporting.sql');
  const columns = tableDefinition('Evidencia_Mantenimientos')?.columns || [];

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "ReportaAveria" TEXT/);
  assert.match(migration, /SET "ReportaAveria" = 'No'/);
  assert.ok(columns.includes('ReportaAveria'));
});

test('fault notification uses a PostgreSQL transaction, advisory lock and the existing notification outbox', () => {
  const module = source('../src/modules/maintenance.module.js');
  const service = source('../src/services/maintenance-device-fault-notification.service.js');

  assert.match(module, /withTransaction/);
  assert.match(module, /pg_advisory_xact_lock/);
  assert.match(module, /claimMaintenanceDeviceFaultNotification/);
  assert.match(module, /deliverMaintenanceDeviceFaultNotification/);
  assert.match(service, /appendRow\('Notificaciones'/);
  assert.match(service, /ClaveIdempotencia/);
  assert.match(service, /maintenance-device-fault:/);
  assert.match(service, /maintenance\.device\.failure\.send/);
});

test('only explicit device saves can persist and notify ReportaAveria', () => {
  const module = source('../src/modules/maintenance.module.js');

  assert.match(module, /deviceCreate:[\s\S]*forceNew: true/);
  assert.match(module, /deviceUpdate:[\s\S]*newFaultEvent/);
  assert.match(module, /delete autosavePayload\.ReportaAveria/);
  assert.match(module, /delete autosavePayload\.reportaAveria/);
  assert.match(module, /REPORTAR_AVERIA_DISPOSITIVO/);
  assert.match(module, /REINTENTAR_CORREO_AVERIA_DISPOSITIVO/);
});

test('Apps Script exposes an idempotent maintenance device fault action', () => {
  const appsScript = source('../../apps-script/report-service/Code.gs');

  assert.match(appsScript, /MAINTENANCE_DEVICE_FAILURE_ACTION = 'maintenance\.device\.failure\.send'/);
  assert.match(appsScript, /MAINTENANCE_DEVICE_FAILURE_/);
  assert.match(appsScript, /sendMaintenanceDeviceFailureEmail_/);
  assert.match(appsScript, /sendDmsEmail_/);
  assert.match(appsScript, /V7\.13-MAINTENANCE-FAULT-ALERTS/);
});
