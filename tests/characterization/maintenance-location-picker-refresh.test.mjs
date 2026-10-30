import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el selector reutiliza relaciones de cliente por lote, sin N+1 por sede', () => {
  const selector = source('src/components/maintenance/MaintenanceEquipmentLocationSelect.jsx');
  const relations = source('src/services/clientRelations.js');

  assert.match(selector, /import \{ fetchClientRelations \} from '\.\.\/\.\.\/services\/clientRelations'/);
  assert.match(selector, /fetchClientRelations\(\{ clientId: resolvedClientId, sessionToken \}\)/);
  assert.match(selector, /const fetched = equipmentRows\s*\.map\(/);
  assert.doesNotMatch(selector, /Promise\.allSettled\(locations\.map/);
  assert.doesNotMatch(selector, /locations\.map\(\(location\) => requestAvailable/);
  assert.match(relations, /clients\.relations\.get/);
  assert.match(relations, /loadLegacyRelations/);
  assert.match(selector, /else if \(locationId\)/, 'se conserva el respaldo sin id de cliente');
});

test('la ubicación nueva se selecciona y vincula antes de emitir la recarga de catálogo', () => {
  const selector = source('src/components/maintenance/MaintenanceEquipmentLocationSelect.jsx');
  const modal = source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const backend = source('backend/src/core/action-router.js');

  assert.match(selector, /onChange\?\.\(created\.value, created\.name, created\.locationId, created\.locationName\);[\s\S]*await onCreated\?\.\(\{/);
  assert.ok(selector.indexOf('await onCreated?.(') < selector.indexOf("window.dispatchEvent(new CustomEvent('dms-client-equipment-catalog-updated'"), 'la invalidación ocurre después de guardar');
  assert.match(modal, /onCreated=\{handleCreated\}/);
  assert.match(modal, /const saved = await onSave\?\.\(location\);\s*if \(saved\) setSelection\(null\)/);
  assert.match(modal, /const saved = await onSave\?\.\(selection\);\s*if \(saved\) setSelection\(null\)/, 'un error de guardado conserva la selección para reintentar');
  assert.match(detail, /clientId=\{String\(pick\(row, \['ClienteID', 'ClienteRef'\]/);
  assert.match(detail, /async function addLocation\(location\)[\s\S]*saveLocations\(\[\.\.\.maintenanceLocations, location\]/);
  assert.match(detail, /optimisticLocations\(nextLocations\)/);
  assert.match(backend, /maintenance\.update\.locations/);
  assert.match(backend, /maintenanceEditPermissions/, 'se conservan permisos existentes en el backend');
});
