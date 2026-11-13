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
  assert.match(modal, /const saved = await onSave\?\.\(location, \{ importInventoryDevices: false \}\);[\s\S]*if \(saved\)/);
  assert.match(modal, /const saved = await onSave\?\.\(selection, \{ importInventoryDevices: includeInventoryDevices \}\);[\s\S]*if \(saved\)/, 'un error de guardado conserva la selección para reintentar');
  assert.match(detail, /clientId=\{String\(pick\(row, \['ClienteID', 'ClienteRef'\]/);
  assert.match(detail, /async function addLocation\(location, \{ importInventoryDevices = false \} = \{\}\)[\s\S]*saveLocations\([\s\S]*\[\.\.\.maintenanceLocations, location\]/);
  assert.match(detail, /optimisticLocations\(nextLocations\)/);
  assert.match(backend, /maintenance\.update\.locations/);
  assert.match(backend, /maintenanceEditPermissions/, 'se conservan permisos existentes en el backend');
});


test('al agregar una ubicación solo se ofrece copiar equipos cuando hay inventario generado', () => {
  const modal=source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  const detail=source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const css=source('src/styles/maintenance-location-workflow.css');
  const api=source('src/services/moduleApi.js');
  assert.match(modal,/requestAvailable\(MODULE_ROUTES\.inventory\.devices/);
  assert.match(modal,/equipmentLocationId: selection\.id/);
  assert.match(modal,/clienteId: clientId/);
  assert.match(modal,/setIncludeInventoryDevices\(false\)/);
  assert.match(modal,/inventoryPreview\?\.generated && !projectMode/);
  assert.match(modal,/type="checkbox" checked=\{includeInventoryDevices\}/);
  assert.match(modal,/inventoryPreview\.count < 1/);
  assert.match(modal,/if \(!open \|\| !selection\?\.id \|\| !clientId \|\| !sessionToken \|\| projectMode/);
  assert.match(modal,/navigator\.onLine === false/);
  assert.match(modal,/onSave\?\.\(location, \{ importInventoryDevices: false \}\)/);
  assert.match(detail,/importInventoryLocationId: importInventoryDevices \? location\.id : ''/);
  assert.match(detail,/importedInventoryDevices/);
  assert.match(detail,/optimisticLocations\(previous\)/);
  assert.match(api,/devices: \['inventory\.devices\.list'\]/);
  assert.match(css,/\.maintenance-location-picker-modal__inventory-copy/);
  assert.match(css,/var\(--surface-low\)/);
  assert.match(css,/var\(--text\)/);
});

test('el backend copia solo datos técnicos con inserción batch, de forma atómica y sin duplicar', () => {
  const mod=source('backend/src/modules/maintenance-location-groups.module.js');
  const count=source('backend/src/modules/maintenance.module.js');
  const inventory=source('backend/src/modules/client-inventory.module.js');
  const migration=source('backend/migrations/024_client_inventory_manual_links.sql');
  const router=source('backend/src/core/action-router.js');
  assert.match(mod,/return withLocationWrite\(maintenanceId, \(\) => withTransaction\(async \(\) => \{/);
  assert.match(mod,/FOR UPDATE/);
  assert.match(mod,/prepareInventoryLocationImport\(ctx, maintenance, group, allDevices\)/);
  assert.match(mod,/details->>'equipmentLocationId'=\$2/);
  assert.match(mod,/JOIN dms_client_inventory inv ON inv\.client_id=d\.client_id/);
  assert.match(mod,/MAX_IMPORTED_INVENTORY_DEVICES/);
  assert.match(mod,/if \(!requestedSet\.has\(importId\)\)/);
  assert.match(mod,/expectedMaintenanceCountForDevice\(maintenance,row\)\.planned <= 0/);
  assert.match(mod,/appendRows\('Evidencia_Mantenimientos', imported\)/);
  assert.match(mod,/raiseExpectedCountsForCreatedDevices\(ctx, maintenance, imported\)/);
  assert.match(mod,/IMPORTAR_UBICACION_DESDE_INVENTARIO/);
  assert.match(mod,/importedInventoryDevices: imported\.length/);
  assert.match(mod,/inventoryImportedDeviceId\(maintenanceId, inventoryDeviceId\)/);
  assert.match(mod,/ids\.has\(row\.EvidenciaMantenimientoID\)/);
  assert.match(mod,/identities\.has\(identity\)/);
  assert.match(count,/export async function raiseExpectedCountsForCreatedDevices/);
  assert.match(count,/GROUP BY "TipoDispositivoID", "TipoDispositivo", "Categoria"/);
  assert.match(count,/return raiseExpectedCountsForCreatedDevices\(ctx, maintenance, \[created\]\)/);
  assert.match(inventory,/equipmentLocationId = clean\(ctx\.payload\?\.equipmentLocationId\)/);
  assert.match(inventory,/filterSql\.replace\('=\$5', '=\$3'\)/);
  assert.match(migration,/ix_dms_client_inventory_devices_equipment_location/);
  assert.match(router,/maintenanceEditPermissions/);
  assert.doesNotMatch(mod,/UPDATE "Boletas"|INSERT INTO "Mantenimiento imagenes"|FROM "EvidenciasBoleta"/);
});

test('nuevos dispositivos reciclados nunca conservan estados ni evidencias de una visita anterior', async () => {
  const { createHash } = await import('node:crypto');
  const script=source('backend/src/modules/maintenance-location-groups.module.js');
  const start=script.indexOf('function sameImportIdentity(');
  const end=script.indexOf('async function inventoryDevicesForEquipmentLocation(',start);
  assert.ok(start>=0 && end>start,'el adaptador debe permanecer en el flujo actual');
  const clean=(v)=>String(v??'').trim();
  const normalized=(v)=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const adapter=new Function('createHash','nowIso','clean','normalized',
    script.slice(start,end) + '\nreturn { sameImportIdentity, inventoryImportedDeviceId, inventoryDeviceToMaintenanceRow };')(
      createHash,()=> '2026-11-13T13:00:00Z',clean,normalized);
  const sourceRecord={
    device_id:'inventory-123',
    device_type:'Cámara',
    device_name:'Puesto 12 C3',
    manufacturer:'Axis',
    model:'P3267',
    serial:'S-42',
    mac:'AA:BB:CC:DD:EE:01',
    details:{ typeId:'tipo-camara', manufacturerId:'axis', modelId:'p3267', functioning:'Sí',
      state:'Correcto', currentStatus:{ summary:'Todo funciona' },aliases:['C3 Puesto 12'] },
  };
  const details={maintenanceId:'mnt-123',equipmentLocationId:'floor-1',
    equipmentLocationName:'Piso 1',actor:'technical-user'};
  const fresh=adapter.inventoryDeviceToMaintenanceRow(sourceRecord,details);
  assert.equal(fresh.NombreDispositivo,'Puesto 12 C3');
  assert.equal(fresh.Categoria,'Cámara');
  assert.equal(fresh.TipoDispositivoID,'tipo-camara');
  assert.equal(fresh.Fabricante,'Axis');
  assert.equal(fresh.FabricanteID,'axis');
  assert.equal(fresh.Modelo,'P3267');
  assert.equal(fresh.ModeloID,'p3267');
  assert.equal(fresh.Serie,'S-42');
  assert.equal(fresh.DireccionMAC,'AA:BB:CC:DD:EE:01');
  assert.equal(fresh.UbicacionEquipoID,'floor-1');
  assert.equal(fresh.Zona,'Piso 1');
  assert.equal(fresh.Estado,'Pendiente');
  assert.equal(fresh.Funcionamiento,'');
  assert.equal(fresh.Observacion,'');
  assert.equal(fresh.RespuestasJSON,'{}');
  assert.equal(fresh.TecnicoIDsJSON,'[]');
  assert.equal(fresh.FechaTrabajo,'');
  assert.equal(fresh.Activo,true);
  assert.equal(fresh.EvidenciaMantenimientoID,
    adapter.inventoryImportedDeviceId(details.maintenanceId,sourceRecord.device_id));
  assert.notEqual(adapter.inventoryImportedDeviceId('otro-mantenimiento',sourceRecord.device_id),fresh.EvidenciaMantenimientoID);
  assert.ok(adapter.sameImportIdentity(fresh));
});
