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
  assert.match(module, /if \(total <= planned\) return/);
  assert.match(module, /await appendRow\('Evidencia_Mantenimientos', row\);[\s\S]*await raiseExpectedCountForCreatedDevice/);
  assert.match(module, /AJUSTAR_CANTIDAD_ESPERADA_AUTOMATICA/);
  assert.match(module, /SELECT "TipoDispositivoID", "TipoDispositivo", "Categoria", COUNT\(\*\)/);
  assert.match(module, /if \(existing\) \{[\s\S]*return existing;/);
});
