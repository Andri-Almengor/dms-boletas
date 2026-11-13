import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  normalizeInventoryText, sameInventoryDevice, groupInventoryDevices,
  candidateInventoryAliases, mergeInventoryAliases, attachInventoryTickets,
  buildInventorySnapshot,
} from '../../backend/src/core/client-inventory-domain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (filename) => readFileSync(path.join(ROOT, filename), 'utf8');

const camera = (id, name, extra = {}) => ({
  EvidenciaMantenimientoID: id, MantenimientoRef: 'maintenance-1',
  TipoDispositivo: 'Cámara', TipoDispositivoID: 'type-camera', Zona: 'Piso 1',
  UbicacionEquipoID: 'floor-1', Modelo: 'Q6135', ModeloID: 'model-1',
  Fabricante: 'Axis', FabricanteID: 'maker-1',
  NombreDispositivo: name, FechaTrabajo: '2026-11-13',
  maintenanceTitle: 'Mantenimiento de cámaras', Tecnicos: 'Técnico A', ...extra,
});

test('unifica puestos con palabras reordenadas sin volver a crear dos dispositivos', () => {
  const result = groupInventoryDevices([
    camera('device-1','Puesto 12 C3'),
    camera('device-2','C3 puesto 12', { Observacion: 'Limpieza realizada' }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sources.length, 2);
  assert.deepEqual(result[0].aliases.sort(), ['C3 puesto 12','Puesto 12 C3']);
});

test('no confunde cámaras con números diferentes, mismo nombre genérico o serie distinta', () => {
  const a = camera('one','Puesto 12 C3');
  const b = camera('two','Puesto 12 C4');
  assert.equal(sameInventoryDevice(a,b), false);
  assert.equal(groupInventoryDevices([a,b]).length, 2);
  assert.equal(groupInventoryDevices([
    camera('three','Cámara'), camera('four','Cámara'),
  ]).length, 2);
  assert.equal(sameInventoryDevice(
    camera('one','Puesto 12 C3',{Serie:'ABC'}),
    camera('two','C3 puesto 12',{Serie:'XYZ'}),
  ), false);
});

test('la serie inequívoca permite conservar historial si el equipo cambió de ubicación', () => {
  const result = groupInventoryDevices([
    camera('old','Puesto 12 C3',{ Serie:'SERIE-123',UbicacionEquipoID:'old-location' }),
    camera('new','Cámara de puesto 12',{ Serie:'SERIE-123',UbicacionEquipoID:'new-location' }),
  ]);
  assert.equal(result.length,1);
});

test('las sugerencias de Gemini se validan y no pueden mezclar números/series distintas', () => {
  const groups = groupInventoryDevices([
    camera('one','Puesto 12 C3'),
    camera('two','Cámara puesto 12 C3'),
    camera('three','Puesto 12 C4'),
  ]);
  const candidates = candidateInventoryAliases(groups);
  const approved = candidates.map((pair) => ({ left:pair.left,right:pair.right,confidence:.99 }));
  const joined = mergeInventoryAliases(groups,candidates,approved);
  assert.equal(joined.length,2);
  assert.equal(joined.some((g) => g.sources.length===2),true);
});

test('las boletas solo se asocian por identidad inequívoca y no por una descripción genérica', () => {
  const groups = groupInventoryDevices([
    camera('one','Puesto 12 C3'),
    camera('two','Puesto 12 C4'),
  ]);
  const tickets = [
    {BoletaUID:'ticket-1',Titulo:'Inspección de cámara',TipoDispositivo:'Cámara'},
    {BoletaUID:'ticket-2',Titulo:'Revisión C3 puesto 12',TipoDispositivo:'Cámara',
      UbicacionEquipoID:'floor-1',Resultado:'Limpieza completada'},
  ];
  const match=attachInventoryTickets(groups,tickets,[]);
  assert.equal([...match.values()].flat().length,1);
  assert.equal([...match.values()].flat()[0].ticket.BoletaUID,'ticket-2');
});

test('construye historial fechado, técnicos, enlaces y galería con procedencia', () => {
  const groups=groupInventoryDevices([camera('one','Puesto 12 C3',{
    Observacion:'Se revisó la alimentación',maintenanceDate:'2026-11-13',
  })]);
  const snapshot=buildInventorySnapshot({
    clientId:'client-1',groups,
    tickets:[{BoletaUID:'ticket-1',TipoDispositivo:'Cámara',Titulo:'Atención en puesto 12 C3',
      UbicacionEquipoID:'floor-1',Fecha:'2026-11-13',Resultado:'Equipo funcionando',assignees:'Técnico B'}],
    ticketEvidence:[{EvidenciaID:'ticket-media-1',BoletaUID:'ticket-1',ArchivoID:'file-b',
      MimeType:'image/jpeg',FechaCreacion:'2026-11-13'}],
    maintenanceImages:[{FotoDispositivoID:'mnt-media-1',DispositivoMantenimientoRef:'one',
      DriveFileID:'file-m',MimeType:'image/jpeg',FechaCaptura:'2026-11-13'}],
  });
  assert.equal(snapshot.devices.length,1);
  assert.equal(snapshot.events.length,2);
  assert.equal(snapshot.media.length,2);
  assert.equal(snapshot.events.find((e)=>e.type==='BOLETA').technicians,'Técnico B');
  assert.equal(snapshot.media.find((e)=>e.type==='MANTENIMIENTO').sourceId,'maintenance-1');
});

test('el inventario es manual, PostgreSQL, con validación backend de permisos y datos acotados', () => {
  const router=source('backend/src/core/action-router.js');
  const module=source('backend/src/modules/client-inventory.module.js');
  const app=source('src/app/App.jsx');
  const shell=source('src/components/layout/AppShell.jsx');
  const page=source('src/pages/inventory/ClientInventoryPage.jsx');
  const migration=source('backend/migrations/023_client_inventory.sql');
  const queue=source('backend/src/services/action-concurrency.service.js');
  assert.match(router,/inventory\.generate', clientInventoryHandlers\.generate, 'USUARIOS_GESTIONAR'/);
  assert.match(router,/inventory\.device\.get', clientInventoryHandlers\.detail, maintenanceReadPermissions/);
  assert.match(module,/adminGuard\(ctx\)/);
  assert.match(module,/SELECT pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(module,/withTransaction\(async \(\)/);
  assert.match(module,/await audit\(ctx, 'GENERAR_INVENTARIO_CLIENTE'/);
  assert.match(module,/m\."ClienteID"=\$1/);
  assert.match(module,/LIMIT \$2/);
  assert.match(module,/SELECT 1 FROM "BoletaAsignados"/);
  assert.match(migration,/FOREIGN KEY\(client_id, device_id\)/);
  assert.match(migration,/PRIMARY KEY\(client_id, device_id\)/);
  assert.match(queue,/normalizedRoute\(route\) === 'inventory\.generate'/);
  assert.match(app,/path="inventario\/:clienteId"/);
  assert.match(shell,/to="\/inventario"/);
  assert.match(page,/sourceLoader=\{sourceLoader\}/);
  assert.match(page,/target="_blank"/);
});

test('la normalización conserva números y no inventa identificadores', () => {
  assert.equal(normalizeInventoryText(' C3 - Puesto 12 '),'c3 puesto 12');
  assert.notEqual(normalizeInventoryText('Puesto 12 C3'),normalizeInventoryText('Puesto 12 C4'));
});


test('no fusiona el mismo número de serie cuando el fabricante es diferente', () => {
  const first = camera('one','Puesto 12 C3',{ Serie:'SERIE-123',FabricanteID:'manufacturer-A' });
  const second = camera('two','Puesto 12 C3',{ Serie:'SERIE-123',FabricanteID:'manufacturer-B' });
  assert.equal(sameInventoryDevice(first,second),false);
  assert.equal(groupInventoryDevices([first,second]).length,2);
});

test('historial de mantenimiento incorpora checklist de Sí/No sin modificar los registros', () => {
  const snapshot = buildInventorySnapshot({
    clientId:'test-client',
    groups:groupInventoryDevices([camera('one','C3 puesto 12',{
      RespuestasJSON: JSON.stringify({ limpieza:'Sí', conexion:'No', __preguntas:[
        { key:'limpieza',label:'¿Se realizó la limpieza?' },
        { key:'conexion',label:'¿La conexión es correcta?' },
      ] }),
    })]),
  });
  assert.equal(snapshot.events.length,1);
  assert.match(snapshot.events[0].summary,/¿Se realizó la limpieza\?: Sí/);
  assert.match(snapshot.events[0].summary,/¿La conexión es correcta\?: No/);
});

test('consulta de boletas respeta el esquema existente sin columna Activo', () => {
  const module = source('backend/src/modules/client-inventory.module.js');
  assert.doesNotMatch(module, /active\('b'\)/);
  assert.match(module,/b\."__valid"=TRUE/);
  assert.match(module,/eventOffset/);
  assert.match(module,/mediaOffset/);
  assert.match(module,/LIMIT \$5 OFFSET \$6/);
  assert.match(module,/hasMoreEvents/);
  assert.match(module,/hasMoreMedia/);
  const page = source('src/pages/inventory/ClientInventoryPage.jsx');
  assert.match(page,/Mostrar más trabajos/);
  assert.match(page,/Mostrar más fotografías/);
  assert.match(page,/pendingArrowRef/);
});


test('Supervisor y Administrador pueden generar y actualizar el inventario con los mismos permisos heredados', async () => {
  const { calculateUserPermissions } = await import('../../backend/src/services/permissions.service.js');
  const tables = {
    Roles: [
      { RolID: 'admin', Nombre: 'Administrador', EsAdministrador: 'true', Estado: 'ACTIVO' },
      { RolID: 'supervisor', Nombre: 'Supervisor', EsAdministrador: 'true', Estado: 'ACTIVO' },
      { RolID: 'tech', Nombre: 'Técnico', EsAdministrador: 'false', Estado: 'ACTIVO' },
    ],
    Permisos: [
      { PermisoID: 'manage', Codigo: 'USUARIOS_GESTIONAR', Estado: 'ACTIVO' },
      { PermisoID: 'read', Codigo: 'MANTENIMIENTOS_VER', Estado: 'ACTIVO' },
    ],
    RolPermisos: [{ RolID: 'tech', PermisoID: 'read', Permitido: true }],
    UsuarioPermisos: [],
  };
  const adminPermissions = calculateUserPermissions({ RolID: 'admin', UsuarioID: 'admin-1' }, tables);
  const supervisorPermissions = calculateUserPermissions({ RolID: 'supervisor', UsuarioID: 'supervisor-1' }, tables);
  const technicianPermissions = calculateUserPermissions({ RolID: 'tech', UsuarioID: 'tech-1' }, tables);
  assert.deepEqual(supervisorPermissions, adminPermissions);
  assert.ok(supervisorPermissions.includes('USUARIOS_GESTIONAR'));
  assert.ok(!technicianPermissions.includes('USUARIOS_GESTIONAR'));
  assert.ok(technicianPermissions.includes('MANTENIMIENTOS_VER'));

  const router = source('backend/src/core/action-router.js');
  const module = source('backend/src/modules/client-inventory.module.js');
  const page = source('src/pages/inventory/ClientInventoryPage.jsx');
  const sql = source('backend/migrations/022_supervisor_role.sql');

  assert.match(sql, /'Supervisor'/);
  assert.match(sql, /'true', 'ACTIVO'/);
  assert.match(router, /add\('inventory\.generate', clientInventoryHandlers\.generate, 'USUARIOS_GESTIONAR'\)/);
  assert.match(module, /const canAdmin = \(ctx\) => ctx\.permissions\?\.includes\('USUARIOS_GESTIONAR'\)/);
  assert.match(module, /if \(!canAdmin\(ctx\)\) throw forbidden/);
  assert.match(page, /const isAdmin=hasPermission\('USUARIOS_GESTIONAR'\)/);
  assert.match(page, /\{isAdmin && <button type="button" className="button button--primary"/);
  assert.match(page, /Administrador o Supervisor/);
});
