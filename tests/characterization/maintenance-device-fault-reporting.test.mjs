import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la pregunta de avería es compartida por Mantenimiento y Proyecto', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const formData = source('src/pages/maintenance/maintenanceFormData.js');

  assert.match(editor, /¿Se reporta avería en este equipo\?/);
  assert.match(editor, /device\.reportaAveria/);
  assert.match(editor, /Esta pregunta aplica tanto a mantenimientos como a proyectos/);
  assert.match(formData, /reportaAveria: 'No'/);
  assert.match(formData, /ReportaAveria: device\.reportaAveria \|\| 'No'/);
});

test('ReportaAveria participa en sync/offline y conflictos', () => {
  const syncBase = source('src/services/maintenanceSyncBase.js');
  const conflict = source('backend/src/services/maintenance-sync-conflict.patch.js');

  assert.match(syncBase, /ReportaAveria: \['reportaAveria'\]/);
  assert.match(conflict, /ReportaAveria: \['reportaAveria'\]/);
});

test('el destinatario de averías reutiliza la configuración central de notificaciones', () => {
  const backend = source('backend/src/services/notification-email-settings.service.js');
  const page = source('src/pages/admin/NotificationSettingsPage.jsx');
  const panel = source('src/components/cases/NotificationEmailSettingsPanel.jsx');

  assert.match(backend, /CORREOS_AVERIAS_MANTENIMIENTO/);
  assert.match(backend, /maintenanceFaultTo/);
  assert.match(page, /Averías de mantenimiento/);
  assert.match(page, /maintenanceFaultTo/);
  assert.match(panel, /Averías de mantenimiento/);
  assert.match(panel, /maintenanceFaultTo/);
});

test('un fallo de correo no convierte un dispositivo ya guardado en un fallo de persistencia', () => {
  const persistence = source('src/services/maintenanceDevicePersistence.js');
  const hook = source('src/hooks/useMaintenanceForm.js');

  assert.match(persistence, /faultNotification/);
  assert.match(persistence, /warningMessage/);
  assert.match(hook, /if \(result\.warningMessage\) setError\(result\.warningMessage\)/);
});
