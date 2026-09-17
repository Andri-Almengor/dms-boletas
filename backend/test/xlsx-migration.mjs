import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { EXPECTED_WORKBOOK_SHEETS } from '../src/config/database-tables.js';
import { analyzeWorkbook, publicAnalysis } from '../src/scripts/xlsx-migration.js';

test('XLSX analyzer preserves all sheets and reports known anomaly classes without values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dms-xlsx-test-'));
  try {
    const file = path.join(dir, 'fixture.xlsx');
    const workbook = new ExcelJS.Workbook();
    for (const [name, spec] of Object.entries(EXPECTED_WORKBOOK_SHEETS)) {
      const ws = workbook.addWorksheet(name);
      ws.addRow(spec.columns);
    }
    const config = workbook.getWorksheet('Configuracion');
    config.addRow(config.getRow(1).values.slice(1).map((header) => header === 'Clave' ? 'DUP' : header === 'Valor' ? 'one' : ''));
    config.addRow(config.getRow(1).values.slice(1).map((header) => header === 'Clave' ? 'DUP' : header === 'Valor' ? 'two' : ''));
    const malformed = workbook.getWorksheet('FirmaMantenimientoSolicitudes');
    malformed.addRow(malformed.getRow(1).values.slice(1).map((header) => header === 'Estado' ? 'DESPLAZADO' : ''));
    await workbook.xlsx.writeFile(file);
    const analysis = await analyzeWorkbook(file);
    const report = publicAnalysis(analysis);
    assert.equal(report.sheets, Object.keys(EXPECTED_WORKBOOK_SHEETS).length);
    assert.equal(report.rawRows, 3);
    assert.equal(report.anomalyTypes.DUPLICATE_ID, 1);
    assert.equal(report.anomalyTypes.MALFORMED_ROW, 1);
    assert.equal(JSON.stringify(report).includes('DESPLAZADO'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
