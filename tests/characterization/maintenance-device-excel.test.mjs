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
  assert.match(creator, /validateDeviceExcelRows\(/);
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
