import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { DATABASE_TABLES, EXPECTED_WORKBOOK_SHEETS, LEGACY_SHEETS, RELATIONSHIPS } from '../config/database-tables.js';
import { DATE_FIELDS, TIME_FIELDS } from '../config/tables.js';

const LEGACY = new Set(LEGACY_SHEETS);
const DATE_ONLY_FIELDS = new Set(['Fecha', 'FechaTrabajo', 'FechaVisita', 'OrigenMantenimientoFecha']);
const JSON_FIELD = /(JSON|Metadata|OpcionesJSON)$/i;

export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function stableRow(row, headers) { return JSON.stringify(Object.fromEntries(headers.map((header) => [header, row[header] ?? '']))); }
export function rowChecksum(row, headers) { return sha256(stableRow(row, headers)); }
function pad(value) { return String(value).padStart(2, '0'); }

function normalizeDate(date, header) {
  if (TIME_FIELDS.has(header)) return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (DATE_ONLY_FIELDS.has(header)) return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return date.toISOString();
}

function normalizeCell(value, header) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return normalizeDate(value, header);
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return normalizeCell(value.result, header);
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return String(value.text ?? '');
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && TIME_FIELDS.has(header) && value >= 0 && value < 1) {
    const seconds = Math.round((value % 1) * 86400);
    return `${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor((seconds % 3600) / 60))}`;
  }
  if (typeof value === 'number' && DATE_FIELDS.has(header)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (!Number.isNaN(date.getTime())) return DATE_ONLY_FIELDS.has(header) ? date.toISOString().slice(0, 10) : date.toISOString();
  }
  return value;
}

export async function workbookHash(file) {
  const bytes = await readFile(file);
  return { sha256: sha256(bytes), size: bytes.length };
}

export async function analyzeWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const { sha256: fileSha256, size } = await workbookHash(file);
  const sheets = new Map();
  const anomalies = [];
  const duplicateIndex = new Map();
  let sourceRows = 0;
  let formulaCount = 0;

  for (const worksheet of workbook.worksheets) {
    const headers = [];
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const value = cell.value === null || cell.value === undefined ? '' : String(cell.value).trim();
      headers[colNumber - 1] = value;
    });
    while (headers.length && !headers[headers.length - 1]) headers.pop();
    const expected = EXPECTED_WORKBOOK_SHEETS[worksheet.name];
    if (!expected) anomalies.push({ sheet: worksheet.name, row: null, type: 'UNEXPECTED_SHEET', column: '', referenceTable: '', detail: {} });
    else {
      const unexpectedColumns = headers.filter((header) => header && !expected.columns.includes(header));
      const missingColumns = expected.columns.filter((header) => !headers.includes(header));
      for (const column of unexpectedColumns) anomalies.push({ sheet: worksheet.name, row: 1, type: 'UNEXPECTED_COLUMN', column, referenceTable: '', detail: {} });
      for (const column of missingColumns) anomalies.push({ sheet: worksheet.name, row: 1, type: 'MISSING_COLUMN', column, referenceTable: '', detail: {} });
    }

    const rows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
      const excelRow = worksheet.getRow(rowNumber);
      const rawValues = headers.map((header, index) => {
        const cell = excelRow.getCell(index + 1);
        if (cell.type === ExcelJS.ValueType.Formula) formulaCount += 1;
        return normalizeCell(cell.value, header);
      });
      if (!rawValues.some((value) => value !== '' && value !== null && value !== undefined)) continue;
      const data = Object.fromEntries(headers.filter(Boolean).map((header, index) => [header, rawValues[index] ?? '']));
      const checksum = rowChecksum(data, headers.filter(Boolean));
      rows.push({ sourceRowNumber: rowNumber, data, checksum });
      sourceRows += 1;

      for (const [column, value] of Object.entries(data)) {
        if (!JSON_FIELD.test(column) || value === '') continue;
        if (typeof value === 'string') {
          try { JSON.parse(value); } catch { anomalies.push({ sheet: worksheet.name, row: rowNumber, type: 'INVALID_JSON', column, referenceTable: '', detail: {} }); }
        }
      }
    }
    sheets.set(worksheet.name, { headers: headers.filter(Boolean), rows, legacy: LEGACY.has(worksheet.name) });

    const table = DATABASE_TABLES[worksheet.name];
    if (table) {
      const byId = new Map();
      for (const row of rows) {
        const id = String(row.data[table.id] ?? '').trim();
        if (!id) {
          const type = worksheet.name === 'FirmaMantenimientoSolicitudes' ? 'MALFORMED_ROW' : 'MISSING_ID';
          anomalies.push({ sheet: worksheet.name, row: row.sourceRowNumber, type, column: table.id, referenceTable: '', detail: {} });
          continue;
        }
        const list = byId.get(id) || [];
        list.push(row.sourceRowNumber); byId.set(id, list);
      }
      for (const [, rowNumbers] of byId) {
        if (rowNumbers.length <= 1) continue;
        for (const rowNumber of rowNumbers.slice(1)) anomalies.push({ sheet: worksheet.name, row: rowNumber, type: 'DUPLICATE_ID', column: table.id, referenceTable: '', detail: { occurrences: rowNumbers.length } });
      }
      duplicateIndex.set(worksheet.name, byId);
    }
  }

  for (const sheetName of Object.keys(EXPECTED_WORKBOOK_SHEETS)) {
    if (!sheets.has(sheetName)) anomalies.push({ sheet: sheetName, row: null, type: 'MISSING_SHEET', column: '', referenceTable: '', detail: {} });
  }

  const parentSets = new Map();
  for (const relation of RELATIONSHIPS) {
    const key = `${relation.parent}:${relation.parentColumn}`;
    if (!parentSets.has(key)) {
      const parent = sheets.get(relation.parent);
      parentSets.set(key, new Set((parent?.rows || []).map((row) => String(row.data[relation.parentColumn] ?? '').trim()).filter(Boolean)));
    }
    const validParents = parentSets.get(key);
    for (const row of sheets.get(relation.child)?.rows || []) {
      const value = String(row.data[relation.column] ?? '').trim();
      if (value && !validParents.has(value)) anomalies.push({ sheet: relation.child, row: row.sourceRowNumber, type: 'ORPHAN_REFERENCE', column: relation.column, referenceTable: relation.parent, detail: { parentColumn: relation.parentColumn } });
    }
  }

  const reconciliation = {};
  for (const [name, sheet] of sheets) {
    const sheetAnomalies = anomalies.filter((item) => item.sheet === name);
    const malformed = sheetAnomalies.filter((item) => item.type === 'MALFORMED_ROW').length;
    reconciliation[name] = {
      sourceRows: sheet.rows.length,
      rawRows: sheet.rows.length,
      canonicalRows: sheet.legacy ? 0 : sheet.rows.length,
      validCanonicalRows: sheet.legacy ? 0 : Math.max(0, sheet.rows.length - malformed),
      duplicates: sheetAnomalies.filter((item) => item.type === 'DUPLICATE_ID').length,
      malformed,
      orphans: sheetAnomalies.filter((item) => item.type === 'ORPHAN_REFERENCE').length,
      checksum: sha256(sheet.rows.map((row) => `${row.sourceRowNumber}:${row.checksum}`).join('|')),
      status: 'READY',
    };
  }

  return {
    runId: randomUUID(),
    file: { name: path.basename(file), sha256: fileSha256, size },
    workbook: { sheetCount: workbook.worksheets.length, sourceRows, formulaCount },
    sheets,
    anomalies,
    reconciliation,
  };
}

export function publicAnalysis(analysis) {
  const anomalyTypes = {};
  for (const item of analysis.anomalies) anomalyTypes[item.type] = Number(anomalyTypes[item.type] || 0) + 1;
  const canonicalRows = Object.values(analysis.reconciliation).reduce((sum, row) => sum + row.canonicalRows, 0);
  const validCanonicalRows = Object.values(analysis.reconciliation).reduce((sum, row) => sum + row.validCanonicalRows, 0);
  return {
    sourceFile: analysis.file.name,
    sourceSha256: analysis.file.sha256,
    sourceSizeBytes: analysis.file.size,
    sheets: analysis.workbook.sheetCount,
    sourceRows: analysis.workbook.sourceRows,
    formulaCount: analysis.workbook.formulaCount,
    rawRows: analysis.workbook.sourceRows,
    canonicalRows,
    validCanonicalRows,
    legacyRows: analysis.workbook.sourceRows - canonicalRows,
    anomalyCount: analysis.anomalies.length,
    anomalyTypes,
    perSheet: Object.fromEntries(Object.entries(analysis.reconciliation).map(([name, row]) => [name, { sourceRows: row.sourceRows, canonicalRows: row.canonicalRows, validCanonicalRows: row.validCanonicalRows, duplicates: row.duplicates, malformed: row.malformed, orphans: row.orphans, status: row.status }])),
  };
}
