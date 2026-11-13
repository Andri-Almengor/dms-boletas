import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDeviceExcelWorkbook, readDeviceExcelWorkbook } from '../../src/utils/maintenanceExcelWorkbook.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

test('el generador XLSX entrega un ZIP Office válido con encabezados, estilos y hojas', async () => {
  const workbook = createDeviceExcelWorkbook([
    { name: 'Dispositivos', rows: [
      ['UbicacionEquipoID', 'TipoDispositivoID', 'NombreDispositivo', 'Pregunta:limpieza'],
      ['location-1', 'camera-1', 'Cámara & <1>', 'Sí'],
    ] },
    { name: 'Instrucciones', rows: [['PASO', 'INSTRUCCIÓN'], ['1', 'Una fila por equipo']] },
  ]);
  assert.equal(workbook.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const bytes = new Uint8Array(await workbook.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /xl\/worksheets\/sheet1\.xml/);
  assert.match(text, /xl\/styles\.xml/);
  assert.match(text, /Pregunta:limpieza/);
  assert.match(text, /Cámara &amp; &lt;1&gt;/);
  assert.match(text, /Instrucciones/);
});

test('no acepta otro formato disfrazado de Excel', async () => {
  await assert.rejects(
    readDeviceExcelWorkbook({ name: 'equipos.xls', size: 4 }),
    /\.xlsx/,
  );
  await assert.rejects(
    readDeviceExcelWorkbook({ name: 'equipos.xlsx', size: 6 * 1024 * 1024 }),
    /5 MB/,
  );
});

test('el importador reutiliza el catálogo de preguntas, los IDs y el flujo offline existente', () => {
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const mapper = source('src/features/maintenance/maintenanceDeviceExcel.js');
  const reader = source('src/utils/maintenanceExcelWorkbook.js');
  const api = source('src/services/moduleApi.js');

  assert.match(creator, /excelTemplateSheets\(/);
  assert.match(creator, /validateDeviceExcelWorkbook\(/);
  assert.match(creator, /readDeviceExcelWorkbook\(file\)/);
  assert.match(creator, /bulkEntries\.length/);
  assert.match(creator, /if \(item\.done\) continue/);
  assert.match(creator, /MODULE_ROUTES\.maintenance\.deviceCreate/);
  assert.match(creator, /maintenanceDevicePayload\(draft, maintenanceId, maintenanceType\)/);
  assert.match(api, /maintenanceDeviceCreate/);
  assert.match(mapper, /questionsForDevice\(draft, maintenanceType\)/);
  assert.match(mapper, /questionDetails = questions\.map/);
  assert.match(mapper, /UbicacionEquipoID/);
  assert.match(mapper, /TipoDispositivoID/);
  assert.match(mapper, /TecnicoIDs/);
  assert.match(mapper, /MAX_BULK_MAINTENANCE_DEVICES/);
  assert.match(mapper, /projectQuestionRequired/);
  assert.match(mapper, /macAddressError/);
  assert.match(reader, /new DecompressionStream\('deflate-raw'\)/);
});

test('la carga requiere vista previa limpia y se preserva la lista manual', () => {
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  assert.match(creator, /excelIssues\.length > 0/);
  assert.match(creator, /excelRows\.slice\(0, 12\)/);
  assert.match(creator, /Importar desde Excel/);
  assert.match(creator, /Descargar plantilla Excel/);
  assert.match(creator, /bulkNames\.map\(\(name\)/);
  assert.match(creator, /createMaintenanceDevice\(bulkSelectedType\.key, maintenanceType\)/);
  assert.match(creator, /bulkDoneCount === bulkEntries\.length/);
});


test('el XLSX soporta pestañas independientes y desplegables de catálogos y modelos dependientes', async () => {
  const sheets = [
    { name: 'Cámara', rows: [['Nombre del dispositivo', 'Ubicación del equipo', 'Fabricante', 'Modelo',
      'Pregunta: ¿Se realizó la limpieza?']], inputRows: 100, validations: [
      { column: 1, list: 'LOCACIONES' },
      { column: 2, list: 'FABRICANTES_1' },
      { column: 3, formula: 'INDIRECT("MODELOS_1_"&IFERROR(MATCH($C2,FABRICANTES_1,0),0))' },
      { column: 4, list: 'RESPUESTA_SI_NO' },
    ] },
    { name: 'Puertas', rows: [['Nombre del dispositivo', 'Ubicación del equipo',
      'Pregunta: ¿El lector funciona correctamente?']], validations: [{ column: 2, list: 'RESPUESTA_SI_NO' }] },
    { name: 'Listas', rows: [['LOCACIONES', 'FABRICANTES_1', 'RESPUESTA_SI_NO'], ['Sala de control', 'Axis', 'Sí'],
      ['Oficinas', 'Hanwha', 'No']], hidden: true },
  ];
  sheets.definedNames = [
    { name: 'LOCACIONES', formula: "'Listas'!$A$2:$A$3" },
    { name: 'FABRICANTES_1', formula: "'Listas'!$B$2:$B$3" },
    { name: 'RESPUESTA_SI_NO', formula: "'Listas'!$C$2:$C$3" },
  ];
  const text = new TextDecoder().decode(await createDeviceExcelWorkbook(sheets).arrayBuffer());
  assert.match(text, /sheet name="Cámara"/);
  assert.match(text, /sheet name="Puertas"/);
  assert.match(text, /sheet name="Listas"[^>]*state="hidden"/);
  assert.match(text, /<definedName name="FABRICANTES_1"/);
  assert.match(text, /<dataValidations count="4"/);
  assert.match(text, /INDIRECT\(&quot;MODELOS_1_&quot;&amp;IFERROR\(MATCH\(\$C2,FABRICANTES_1,0\),0\)\)/);
  assert.match(text, /RESPUESTA_SI_NO/);
});

test('cada tipo tiene preguntas propias y la plantilla resuelve nombres sin exigir IDs al usuario', () => {
  const mapper = source('src/features/maintenance/maintenanceDeviceExcel.js');
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const reader = source('src/utils/maintenanceExcelWorkbook.js');
  assert.match(mapper, /excelDeviceSheetNames\(deviceTypes/);
  assert.match(mapper, /questionsForDevice\(\{/);
  assert.match(mapper, /questionHeader\(question\)/);
  assert.match(mapper, /translateTechnicians/);
  assert.match(mapper, /Ubicación del equipo/);
  assert.match(mapper, /availableManufacturers\(type, catalogs\)/);
  assert.match(mapper, /availableModels\(type, maker, catalogs\)/);
  assert.match(mapper, /MODELOS_/);
  assert.match(mapper, /RESPUESTA_SI_NO/);
  assert.match(mapper, /pregunta desactualizada/);
  assert.match(mapper, /MAX_BULK_MAINTENANCE_DEVICES/);
  assert.match(reader, /xl\/_rels\/workbook\.xml\.rels/);
  assert.match(reader, /wb\.getElementsByTagName\('sheet'\)/);
  assert.match(creator, /setExcelLocations/);
  assert.match(creator, /group\.available && group\.active && !group\.foreignClient/);
});

test('el ajuste esperado ocurre solo en un alta real y dentro de la transacción de PostgreSQL', () => {
  const module = source('backend/src/modules/maintenance.module.js');
  assert.match(module, /withDeviceCreateLock\(\(\) => withTransaction\(async \(\) => \{/);
  assert.match(module, /SELECT "MantenimientoID" FROM "Mantenimiento"/);
  assert.match(module, /FOR UPDATE/);
  // El helper compartido mantiene la misma condición para no reducir planes:
  // en lote continúa con el siguiente tipo, en alta individual termina sin cambios.
  assert.match(module, /if \(total <= target\.planned\) continue/);
  assert.match(module, /if \(!changes\.length\) return/);
  assert.match(module, /export async function raiseExpectedCountsForCreatedDevices/);
  assert.match(module, /await appendRow\('Evidencia_Mantenimientos', row\);[\s\S]*await raiseExpectedCountForCreatedDevice/);
  assert.match(module, /AJUSTAR_CANTIDAD_ESPERADA_AUTOMATICA/);
  assert.match(module, /SELECT "TipoDispositivoID", "TipoDispositivo", "Categoria", COUNT\(\*\)/);
  assert.match(module, /if \(existing\) \{[\s\S]*return existing;/);
});


test('los modelos del Excel dependen del fabricante y tipo, incluidos los catálogos históricos vinculados', () => {
  const sourceText = source('src/features/maintenance/maintenanceDeviceExcel.js');
  const start = sourceText.indexOf('function availableModels(');
  const end = sourceText.indexOf('function questionHeader(', start);
  assert.ok(start >= 0 && end > start);
  const clean = (value) => String(value ?? '').trim();
  const pick = (row, names) => names.map((name) => row?.[name]).find((value) => value !== undefined && value !== '') || '';
  const identity = (value) => clean(value).toLowerCase();
  const availableModels = new Function('clean', 'pick', 'identity',
    sourceText.slice(start, end) + '\nreturn availableModels;')(clean, pick, identity);
  const catalogs = {
    relations: [{ TipoDispositivoID:'camera', FabricanteID:'axis', Activo:true }],
    models: [
      { ModeloID:'m1', Nombre:'Modelo de cámara', TipoDispositivoID:'camera', FabricanteID:'axis' },
      { ModeloID:'m2', Nombre:'Modelo histórico relacionado', FabricanteID:'axis' },
      { ModeloID:'m3', Nombre:'Modelo de puertas', TipoDispositivoID:'door', FabricanteID:'axis' },
      { ModeloID:'m4', Nombre:'Otro fabricante', TipoDispositivoID:'camera', FabricanteID:'other' },
      { ModeloID:'m5', Nombre:'Modelo inactivo', TipoDispositivoID:'camera', FabricanteID:'axis', Activo:false },
    ],
  };
  const names = availableModels({ typeId:'camera' }, { FabricanteID:'axis' }, catalogs)
    .map((row) => row.Nombre);
  assert.deepEqual(names, ['Modelo de cámara','Modelo histórico relacionado']);
  assert.deepEqual(availableModels({ typeId:'door' }, { FabricanteID:'axis' }, catalogs)
    .map((row) => row.Nombre), ['Modelo de puertas']);
});

test('el XLSX exporta los rangos de modelos con fórmula Excel dependiente de cada fila y fabricante', async () => {
  const sheets = [
    { name:'Cámara',rows:[['Nombre del dispositivo','Ubicación del equipo','Fabricante','Modelo']],
      inputRows:20, validations:[
        { column:2,list:'FABRICANTES_1' },
        { column:3,formula:'INDIRECT("MODELOS_1_"&IFERROR(MATCH($C2,FABRICANTES_1,0),0))' },
      ] },
    { name:'Listas',hidden:true,rows:[
      ['FABRICANTES_1','MODELOS_1_1','MODELOS_1_2','SIN_MODELOS'],
      ['Axis','Q6135','Modelo 2',''],
    ] },
  ];
  sheets.definedNames=[
    { name:'FABRICANTES_1', formula:"'Listas'!$A$2:$A$2" },
    { name:'MODELOS_1_1', formula:"'Listas'!$B$2:$B$2" },
    { name:'MODELOS_1_2', formula:"'Listas'!$C$2:$C$2" },
    { name:'SIN_MODELOS', formula:"'Listas'!$D$2:$D$2" },
  ];
  const xml=new TextDecoder().decode(await createDeviceExcelWorkbook(sheets).arrayBuffer());
  assert.match(xml, /<definedName name="MODELOS_1_1">/);
  assert.match(xml, /Q6135/);
  assert.match(xml, /<formula1>FABRICANTES_1<\/formula1>/);
  assert.match(xml, /<formula1>INDIRECT\(&quot;MODELOS_1_&quot;&amp;IFERROR\(MATCH\(\$C2,FABRICANTES_1,0\),0\)\)<\/formula1>/);
  assert.match(sourceTextOrFallback(), /MODELOS_/);
  function sourceTextOrFallback() { return source('src/features/maintenance/maintenanceDeviceExcel.js'); }
});

test('las acciones de Excel conservan etiquetas accesibles y dos botones compactos', () => {
  const creator=source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const css=source('src/styles/maintenance-quick-evidence.css');
  assert.match(creator,/maintenance-bulk-excel__actions/);
  assert.match(creator,/maintenance-bulk-excel__button/);
  assert.match(creator,/aria-label="Importar desde Excel \(\.xlsx\)"/);
  assert.match(css,/\.maintenance-bulk-excel__actions/);
  assert.match(css,/@media\(max-width:620px\)/);
});


test('cada descarga refresca el catálogo real de modelos y no usa una copia obsoleta', () => {
  const creator=source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const hook=source('src/hooks/useMaintenanceDeviceCatalogData.js');
  const start=creator.indexOf('async function downloadExcelTemplate()');
  const end=creator.indexOf('function clearExcel()',start);
  const download=creator.slice(start,end);
  assert.ok(start >= 0 && end > start);
  assert.match(download,/await excelCatalog\.reload\(\{ force: true \}\)/);
  assert.match(download,/catalogs: latestCatalogs/);
  assert.match(download,/setExcelDownloading\(true\)/);
  assert.match(download,/finally \{\s*setExcelDownloading\(false\)/);
  assert.match(hook,/loadCatalogResource\(/);
  assert.match(hook,/force,/);
  assert.match(creator,/excelDownloading \|\| !excelCatalogReady/);
});


// Inspección de las entradas XML reales del ZIP entregado al usuario.
// No basta buscar texto en bytes: eso no demuestra que las validaciones estén
// en la hoja correcta, enlazadas a rangos con nombre existentes.
async function storedExcelEntries(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const textDecoder = new TextDecoder();
  const entries = new Map();
  for (let offset = 0; offset + 30 < bytes.length;) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    assert.equal(method, 0, 'Las plantillas actuales guardan XML ZIP sin comprimir');
    const size = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const extraSize = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = textDecoder.decode(bytes.subarray(nameStart, nameStart + nameSize));
    const contents = nameStart + nameSize + extraSize;
    entries.set(name, textDecoder.decode(bytes.subarray(contents, contents + size)));
    offset = contents + size;
  }
  return entries;
}

test('regresión: todos los desplegables reales del Excel permanecen en el XLSX y tienen rangos definidos', async () => {
  const sources = [
    ['LOCACIONES', ['Oficina principal', 'Sala de control']],
    ['FABRICANTES_1', ['Axis', 'Lenel']],
    ['MODELOS_1_0', []],
    ['MODELOS_1_1', ['Q6135', 'P3267']],
    ['MODELOS_1_2', ['LNL-1320']],
    ['FUNCIONAMIENTO', ['Sí', 'No', 'No aplica']],
    ['EN_USO', ['Sí, en uso', 'No, está guardado', 'No']],
    ['ESTADO', ['Pendiente', 'Correcto', 'Mal estado']],
    ['RESPUESTA_SI_NO', ['Sí', 'No']],
    ['OPCIONES_1_1', ['Realizado', 'Pendiente']],
  ];
  const table = Array.from({ length: 4 }, (_, i) =>
    sources.map(([name, values]) => i === 0 ? name : values[i - 1] || ''));
  const validationRules = [
    { column: 1, list: 'LOCACIONES' },
    { column: 2, list: 'FABRICANTES_1' },
    { column: 3, formula: '=INDIRECT("MODELOS_1_"&IFERROR(MATCH($C2,FABRICANTES_1,0),0))' },
    { column: 8, list: 'FUNCIONAMIENTO' },
    { column: 9, list: 'EN_USO' },
    { column: 10, list: 'ESTADO' },
    { column: 12, list: 'RESPUESTA_SI_NO' },
    { column: 13, list: 'OPCIONES_1_1' },
  ];
  const sheets = [
    { name: 'Cámara', rows: [[
      'Nombre del dispositivo', 'Ubicación del equipo', 'Fabricante', 'Modelo', 'Serie', 'Dirección MAC',
      'Fecha de trabajo', 'Técnicos', 'Funcionamiento', 'En uso', 'Estado', 'Observación',
      'Pregunta: Limpieza', 'Pregunta: Estado de la puerta',
    ]], validations: validationRules, inputRows: 150 },
    { name: 'Listas', hidden: true, rows: table },
  ];
  sheets.definedNames = sources.map(([name], column) => ({
    name,
    formula: "'Listas'!$" + String.fromCharCode(65 + column) + '$2:$'
      + String.fromCharCode(65 + column) + '$4',
  }));
  const entries = await storedExcelEntries(createDeviceExcelWorkbook(sheets));
  const sheetXml = entries.get('xl/worksheets/sheet1.xml');
  const namesXml = entries.get('xl/workbook.xml');
  const listsXml = entries.get('xl/worksheets/sheet2.xml');

  assert.ok(sheetXml && namesXml && listsXml, 'El ZIP debe contener las hojas y el libro');
  assert.match(namesXml, /sheet name="Listas"[^>]*state="hidden"/);
  assert.match(sheetXml, /<dataValidations count="8">/);
  assert.equal((sheetXml.match(/<dataValidation type="list"/g) || []).length, 8);
  const expected = [
    ['B', 'LOCACIONES'], ['C', 'FABRICANTES_1'],
    ['D', 'INDIRECT(&quot;MODELOS_1_&quot;&amp;IFERROR(MATCH($C2,FABRICANTES_1,0),0))'],
    ['I', 'FUNCIONAMIENTO'], ['J', 'EN_USO'], ['K', 'ESTADO'],
    ['M', 'RESPUESTA_SI_NO'], ['N', 'OPCIONES_1_1'],
  ];
  for (const [column, formula] of expected) {
    const rule = sheetXml.match(new RegExp('<dataValidation[^>]*sqref="' + column
      + '2:' + column + '151"[^>]*><formula1>([^<]*)</formula1></dataValidation>'));
    assert.ok(rule, 'Falta el desplegable de la columna ' + column);
    assert.equal(rule[1], formula, 'La fuente de lista debe ser una fórmula OOXML sin prefijo =');
    assert.doesNotMatch(rule[1], /^=/, 'Excel no debe recibir un = adicional en OOXML');
  }
  for (const [name] of sources) {
    assert.ok(namesXml.includes('<definedName name="' + name + '">'),
      'La validación referencia un nombre que no está en el libro: ' + name);
  }
  assert.match(listsXml, /Q6135/);
  assert.match(listsXml, /Sala de control/);
  assert.match(listsXml, /Realizado/);
  const mapper = source('src/features/maintenance/maintenanceDeviceExcel.js');
  for (const column of [1, 2, 3, 8, 9, 10]) {
    assert.match(mapper, new RegExp('column: ' + column + ', (?:list|formula):'));
  }
  assert.match(mapper, /validations\.push\(\{ column: DEVICE_EXCEL_LABELS\.length \+ questionIndex/);
});

test('el serializador XLSX normaliza fórmulas de listas sin cambiar las reglas de importación', async () => {
  const sheets = [
    { name: 'Cámara', rows: [['Fabricante', 'Modelo']], inputRows: 10, validations: [
      { column: 0, list: 'FABRICANTES_1' },
      { column: 1, formula: '=INDIRECT("MODELOS_1_1")' },
    ] },
  ];
  sheets.definedNames = [{ name: 'FABRICANTES_1', formula: "'Cámara'!$A$2:$A$2" }];
  const entries = await storedExcelEntries(createDeviceExcelWorkbook(sheets));
  const xml = entries.get('xl/worksheets/sheet1.xml');
  assert.match(xml, /<formula1>FABRICANTES_1<\/formula1>/);
  assert.match(xml, /<formula1>INDIRECT\(&quot;MODELOS_1_1&quot;\)<\/formula1>/);
  assert.doesNotMatch(xml, /<formula1>=/);
  const reader = source('src/utils/maintenanceExcelWorkbook.js');
  assert.match(reader, /export async function readDeviceExcelWorkbook/);
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  assert.match(creator, /validateDeviceExcelWorkbook/);
});
