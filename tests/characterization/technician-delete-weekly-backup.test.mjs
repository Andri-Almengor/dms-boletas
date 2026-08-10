import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('los técnicos pueden eliminar boletas mediante anulación lógica sin borrado físico', () => {
  const router = source('backend/src/core/action-router.js');
  const tickets = source('backend/src/modules/tickets.module.js');
  const bridge = source('src/components/operational/OperationalDeleteBridge.jsx');
  const auditPatch = source('backend/src/services/ticket-delete-audit.patch.js');

  assert.match(router, /annul:\['boletas\.annul'\]/);
  assert.match(router, /let permission='BOLETAS_EDITAR'/);
  assert.match(tickets, /Estado:\s*'ANULADA'/);
  assert.match(tickets, /String\(row\.Estado \|\| ''\)\.toUpperCase\(\) !== 'ANULADA'/);
  assert.match(bridge, /hasPermission\('BOLETAS_EDITAR'\)/);
  assert.match(bridge, /MODULE_ROUTES\.tickets\.annul/);
  assert.match(bridge, /Eliminar boleta/);
  assert.match(auditPatch, /ELIMINAR_BOLETA/);
  assert.doesNotMatch(bridge, /DELETE FROM|hardDelete/i);
});

test('los técnicos pueden eliminar dispositivos solo mientras el mantenimiento está pendiente', () => {
  const router = source('backend/src/core/action-router.js');
  const patch = source('backend/src/services/maintenance-device-delete-permissions.patch.js');
  const bridge = source('src/components/operational/OperationalDeleteBridge.jsx');

  assert.match(router, /deviceDelete:\['maintenance\.devices\.delete'/);
  assert.match(router, /const maintenanceEditPermissions=\['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR'\]/);
  assert.match(patch, /MANTENIMIENTOS_EDITAR/);
  assert.match(patch, /BOLETAS_EDITAR/);
  assert.match(patch, /PENDIENTE/);
  assert.match(patch, /softDelete\('Evidencia_Mantenimientos'/);
  assert.match(patch, /ELIMINAR_DISPOSITIVO_MANTENIMIENTO/);
  assert.match(bridge, /MODULE_ROUTES\.maintenance\.deviceDelete/);
  assert.match(bridge, /Eliminar dispositivo/);
});

test('el respaldo semanal copia el libro maestro completo y evita duplicar la misma semana', () => {
  const backups = source('backend/src/services/weekly-backup.service.js');
  const config = source('backend/src/modules/config.module.js');
  const server = source('backend/src/server.js');
  const more = source('src/pages/MorePage.jsx');
  const card = source('src/components/admin/WeeklyBackupCard.jsx');

  assert.match(backups, /BACKUP_WEEKLY_ENABLED/);
  assert.match(backups, /BACKUP_LAST_SLOT/);
  assert.match(backups, /America\/Costa_Rica/);
  assert.match(backups, /copyDriveFile/);
  assert.match(backups, /fileId:\s*env\.sheetId/);
  assert.match(backups, /settings\.lastSlot === slot && settings\.lastStatus === 'COMPLETADO'/);
  assert.match(backups, /startWeeklyBackupScheduler/);
  assert.match(backups, /stopWeeklyBackupScheduler/);
  assert.match(config, /BACKUP_SECTION = 'BACKUPS'/);
  assert.match(config, /Solo un administrador puede consultar o modificar las copias de respaldo/);
  assert.match(server, /startWeeklyBackupScheduler\(\)/);
  assert.match(server, /stopWeeklyBackupScheduler\(\)/);
  assert.match(more, /WeeklyBackupCard/);
  assert.match(card, /operation:\s*'UPDATE'/);
  assert.match(card, /operation:\s*'CREATE'/);
  assert.match(card, /Crear respaldo ahora/);
});
