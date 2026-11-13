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


test('el listado de inventario incluye exclusivamente clientes con mantenimientos vigentes', () => {
  const mod = source('backend/src/modules/client-inventory.module.js');
  const clients = mod.slice(mod.indexOf('clients: async (ctx) =>'),mod.indexOf('devices: async (ctx) =>'));
  assert.match(clients, /AND EXISTS\(SELECT 1 FROM "Mantenimiento" m/);
  assert.match(clients, /m\."ClienteID"=c\."ClienteID"/);
  assert.doesNotMatch(clients, /OR EXISTS\(SELECT 1 FROM "Boletas" b/);
  assert.match(clients, /LIMIT \$2 OFFSET \$3/);
  const generate = mod.slice(mod.indexOf('generate: async (ctx) =>'));
  assert.match(generate, /inventory\.client\.hasMaintenance/);
  assert.match(generate, /Este cliente no tiene mantenimientos registrados/);
  assert.match(generate, /adminGuard\(ctx\)/);
});

test('inventario usa tokens de diseño oficiales para tabla, modal, atributos y galería en ambos temas', () => {
  const css = source('src/styles/client-inventory.css');
  const jsx = source('src/pages/inventory/ClientInventoryPage.jsx');
  const tokens = source('src/styles/tokens.css');
  const theme = source('src/styles/theme.css');
  for (const name of ['surface-card','surface-low','outline-soft','text','muted','primary']) {
    assert.match(tokens, new RegExp('--' + name + ':'));
    assert.match(css, new RegExp('var\\(--' + name + '\\)'));
  }
  assert.match(theme, /:root\[data-theme='dark'\]/);
  assert.doesNotMatch(css, /var\(--(?:surface-secondary|border|text-secondary)/);
  assert.match(css, /\.client-inventory-table th\s*\{[^}]*background: var\(--surface-low\)/s);
  assert.match(css, /\.client-inventory-features dd\s*\{[^}]*color: var\(--text\)/s);
  assert.match(css, /\.client-inventory-gallery__info > strong\s*\{[^}]*color: var\(--text\)/s);
  assert.match(css, /\.client-inventory-detail__arrow\s*\{[^}]*background: var\(--surface-high\)/s);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.client-inventory-table__extra \{ display: none; \}/);
  assert.match(jsx, /Clientes con mantenimientos registrados/);
  assert.match(jsx, /client-inventory-client__status/);
  assert.match(jsx, /client-inventory-summary/);
  assert.match(jsx, /client-inventory-gallery__info/);
  assert.match(jsx, /client-inventory-detail__arrow--left/);
  assert.match(jsx, /client-inventory-detail__arrow--right/);
  assert.match(jsx, /sourceLoader=\{sourceLoader\}/);
});

test('la columna de nombre conserva semántica de tabla y la vista móvil mantiene acción de detalle', () => {
  const css = source('src/styles/client-inventory.css');
  const jsx = source('src/pages/inventory/ClientInventoryPage.jsx');
  assert.match(jsx, /<td className="client-inventory-table__name"><span className="client-inventory-table__name-wrap">/);
  assert.match(css, /\.client-inventory-table__name-wrap\s*\{\s*display: flex/);
  assert.doesNotMatch(css, /\.client-inventory-table__name\s*\{\s*display: flex/);
  assert.match(jsx, /aria-label=\{'Ver detalle de '\+item\.name\}/);
});


test('el inventario tiene paginador junto al buscador y total exacto con filtro activo', () => {
  const ui=source('src/pages/inventory/ClientInventoryPage.jsx');
  const api=source('backend/src/modules/client-inventory.module.js');
  const css=source('src/styles/client-inventory.css');
  assert.match(ui,/client-inventory-table-tools/);
  assert.match(ui,/client-inventory-top-pager/);
  assert.match(ui,/aria-label="Página anterior"/);
  assert.match(ui,/aria-label="Página siguiente"/);
  assert.match(ui,/Number\(result\.totalFiltered \?\? result\.total \?\? 0\) \/ 50/);
  assert.match(api,/SELECT COUNT\(\*\)::integer AS count/);
  assert.match(api,/totalFiltered/);
  assert.match(css,/\.client-inventory-top-pager/);
  const main=ui.slice(ui.indexOf('function InventoryClientTable('));
  assert.doesNotMatch(main,/className="client-inventory-pagination"/);
});

test('Más reutiliza permisos para Inventario y el visor compartido importa sus estilos originales', () => {
  const more=source('src/pages/MorePage.jsx');
  const styles=source('src/styles/routes/maintenance.js');
  assert.match(more,/canViewMaintenance && <section/);
  assert.match(more,/<MenuRow to="\/inventario" icon="inventory_2" label="Inventario"/);
  assert.match(styles,/import '\.\.\/ticket-evidence-viewer\.css'/);
  assert.match(styles,/import '\.\.\/client-inventory\.css'/);
  const viewer=source('src/components/tickets/ImageViewer.jsx');
  assert.match(viewer,/image-viewer__nav--previous/);
  assert.match(viewer,/image-viewer__nav--next/);
  assert.match(viewer,/sourceLabel/);
});

test('resumen de estado se guarda solo durante generación manual, con Gemini y modelo alternativo', () => {
  const backend=source('backend/src/modules/client-inventory.module.js');
  const ai=source('backend/src/services/assistant-gemini.service.js');
  const ui=source('src/pages/inventory/ClientInventoryPage.jsx');
  const gen=backend.slice(backend.indexOf('generate: async (ctx) =>'));
  const detail=backend.slice(backend.indexOf('detail: async (ctx) =>'),backend.indexOf('generate: async (ctx) =>'));
  assert.match(gen,/adminGuard\(ctx\)/);
  assert.match(gen,/inventoryCurrentStatusBySource\(preview\)/);
  assert.match(gen,/await withTransaction/);
  assert.ok(gen.indexOf('inventoryCurrentStatusBySource(preview)') < gen.indexOf('await withTransaction'));
  assert.match(gen,/device\.details\.currentStatus = currentStates\.bySource/);
  assert.match(gen,/aiStatus/);
  assert.match(backend,/function latestInventoryEvents\(snapshot\)/);
  assert.match(backend,/recordedCurrentStatus\(work\)/);
  assert.match(backend,/const deadline = Date\.now\(\) \+ 110_000/);
  assert.match(backend,/Math\.min\(3,batches\.length\)/);
  assert.match(ai,/export async function summarizeInventoryDeviceStatuses/);
  assert.match(ai,/GEMINI_FALLBACK_MODELS/);
  assert.match(ai,/No inventes mediciones, reparaciones, fechas, diagnósticos/);
  assert.match(detail,/currentStatus: null/);
  assert.match(detail,/current\?\.sourceType === 'BOLETA'/);
  assert.match(detail,/!events\.some\(\(entry\) => entry\.id === current\.eventKey\)/);
  assert.match(ui,/Estado actual según el último registro/);
  assert.match(ui,/Resumen asistido por Gemini/);
  assert.match(ui,/no es un diagnóstico ni una lectura del equipo en tiempo real/);
  assert.match(ui,/sourceType === 'BOLETA' \? 'última boleta' : 'último mantenimiento'/);
  assert.match(ui,/sourcePath\(current\.details\.currentStatus\.sourceType/);
});
