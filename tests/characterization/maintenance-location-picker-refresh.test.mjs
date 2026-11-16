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
  assert.match(modal,/inventoryPreview\?\.generated && inventoryPreview\.locationId === selection\?\.id && !projectMode/);
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
  assert.match(mod,/const receipt = await withLocationWrite\(maintenanceId, \(\) => withTransaction\(async \(\) => \{/);
  assert.match(mod,/FOR UPDATE/);
  assert.match(mod,/prepareInventoryLocationImport\(ctx, maintenance, group, allDevices\)/);
  assert.match(mod,/details->>'equipmentLocationId'=\$2/);
  assert.match(mod,/JOIN dms_client_inventory inv ON inv\.client_id=d\.client_id/);
  assert.match(mod,/MAX_IMPORTED_INVENTORY_DEVICES/);
  assert.match(mod,/if \(!requestedSet\.has\(importId\)\)/);
  assert.match(mod,/expectedMaintenanceCountForDevice\(maintenance,row\)\.planned <= 0/);
  assert.match(mod,/appendRows\('Evidencia_Mantenimientos', prepared\.rowsToCreate\)/);
  assert.match(mod,/raiseExpectedCountsForCreatedDevices\(ctx, maintenance, inserted\)/);
  assert.match(mod,/IMPORTAR_UBICACION_DESDE_INVENTARIO/);
  assert.match(mod,/importedInventoryDevices: prepared\.rowsToCreate\.length/);
  assert.match(mod,/inventoryImportedDeviceId\(maintenanceId, inventoryDeviceId\)/);
  assert.match(mod,/ids\.has\(row\.EvidenciaMantenimientoID\)/);
  assert.match(mod,/identities\.get\(identity\)/);
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

test('importación por ubicación conserva cada ficha del inventario y permite completar sin duplicar', async () => {
  const { createHash } = await import('node:crypto');
  const code = source('backend/src/modules/maintenance-location-groups.module.js');
  const start = code.indexOf('function sameImportIdentity(');
  const end = code.indexOf('async function inventoryDevicesForEquipmentLocation(', start);
  const clean = (value) => String(value ?? '').trim();
  const normalized = (value) => clean(value).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const build = (expected) => new Function(
    'createHash','nowIso','clean','normalized','badRequest','expectedMaintenanceCountForDevice',
    code.slice(start, end) + '\nreturn { planInventoryLocationImportRows, inventoryImportedDeviceId };',
  )(createHash, () => '2026-11-16T12:00:00Z', clean, normalized,
    (message) => new Error(message), expected);
  const expected = () => ({ planned: 3 });
  const module = build(expected);
  const ctx = { user: { UsuarioID: 'tecnico-1' } };
  const maintenance = { MantenimientoID: 'mto-123' };
  const location = { id: 'piso-1', name: 'Piso 1' };
  const devices = [
    { device_id: 'cam-1', device_type: 'Cámara', device_name: 'Cámara 1', serial: 'SIN SERIE' },
    { device_id: 'cam-2', device_type: 'Cámara', device_name: 'Cámara 2', serial: 'SIN SERIE' },
    { device_id: 'cam-3', device_type: 'Cámara', device_name: 'Cámara 3', serial: 'S-123' },
    { device_id: 'cam-4', device_type: 'Cámara', device_name: 'Cámara 4', serial: 'S-123' },
  ];
  const first = module.planInventoryLocationImportRows(devices, ctx, maintenance, location, []);
  assert.equal(first.sourceCount, 4);
  assert.equal(first.rowsToCreate.length, 4, 'la misma serie no elimina fichas distintas');
  assert.equal(first.alreadyPresent, 0);
  const second = module.planInventoryLocationImportRows(
    devices, ctx, maintenance, location, first.rowsToCreate.slice(0, 2));
  assert.equal(second.rowsToCreate.length, 2, 'completa una importación anterior incompleta');
  assert.equal(second.alreadyPresent, 2);
  const retry = module.planInventoryLocationImportRows(
    devices, ctx, maintenance, location, first.rowsToCreate);
  assert.equal(retry.rowsToCreate.length, 0, 'reintentar no crea duplicados');
  assert.equal(retry.alreadyPresent, 4);
  assert.notEqual(first.rowsToCreate[2].EvidenciaMantenimientoID,first.rowsToCreate[3].EvidenciaMantenimientoID);
  assert.throws(
    () => module.planInventoryLocationImportRows(
      [{ device_id: 'sin-tipo', device_name: 'Equipo X', device_type: '' }],
      ctx, maintenance, location, []),
    /sin nombre o tipo/,
    'no hay inserción parcial silenciosa con fichas incompletas',
  );
  assert.throws(
    () => build(() => ({ planned: 0 })).planInventoryLocationImportRows(
      devices, ctx, maintenance, location, []),
    /sin cantidad planificada/,
    'no se omite la regla del mantenimiento para las cantidades planificadas',
  );
});

test('al completar una ubicación existente se reutiliza la ruta, el bloqueo y el recibo confirmado', () => {
  const backend = source('backend/src/modules/maintenance-location-groups.module.js');
  const modal = source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  assert.match(modal,/duplicate && !includeInventoryDevices/);
  assert.match(modal,/Completar dispositivos desde el inventario/);
  assert.match(detail,/if \(alreadyAdded && !importInventoryDevices\) return false/);
  assert.match(detail,/alreadyAdded \? maintenanceLocations : \[\.\.\.maintenanceLocations, location\]/);
  assert.match(backend,/SELECT "MantenimientoID"[\s\S]*FOR UPDATE/);
  assert.match(backend,/if \(inserted.length !== prepared.rowsToCreate.length\)/);
  assert.match(backend,/alreadyPresentInventoryDevices: prepared.alreadyPresent/);
  assert.match(backend,/inventorySourceCount: prepared.sourceCount/);
  assert.match(backend,/const receipt = await withLocationWrite[\s\S]*\}\)\);[\s\S]*const result = await get/);
  assert.match(detail,/result\?\.mantenimiento &&/);
});

test('los errores de planificación se ven dentro del modal y llevan a cantidades esperadas', () => {
  const modal = source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const steps = source('src/features/maintenance/maintenanceFormOrchestration.js');
  assert.match(modal,/error && <div className="alert alert--error" role="alert">/);
  assert.match(modal,/tipos sin cantidad planificada/i);
  assert.match(modal,/Editar cantidades esperadas/);
  assert.match(modal,/onEditPlannedCounts/);
  assert.match(detail,/error=\{error\}/);
  assert.match(detail,/editar\?step=counts/);
  assert.match(detail,/returnTo: detailUrl/);
  assert.match(steps,/get\('step'\) === 'counts' \? 1 : 0/);
});

test('el detalle del mantenimiento recupera solo sus dispositivos e imágenes en lote', () => {
  const backend = source('backend/src/modules/maintenance.module.js');
  const repo = source('backend/src/infra/postgres.repository.core.js');
  const from = backend.indexOf('async function enrichedMaintenanceById(id)');
  const to = backend.indexOf('function isAdmin(ctx)', from);
  const get = backend.slice(from, to);
  assert.match(get,/findById\('Mantenimiento', id\)/);
  assert.match(get,/findRows\([\s\S]*?'Evidencia_Mantenimientos', \{ MantenimientoRef: id \}/);
  assert.match(get,/DispositivoMantenimientoRef: deviceIds/);
  assert.match(get,/return enrich\(maintenance, \{/);
  assert.doesNotMatch(get,/readTables\(/);
  assert.match(repo,/export async function findRows\(/);
  assert.match(repo,/\$\{_qi\(key\)\} = ANY\(/, 'se usa una consulta batch para imágenes');
});
