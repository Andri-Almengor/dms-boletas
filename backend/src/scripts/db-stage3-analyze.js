import { analyzeWorkbook } from './xlsx-migration.js';

function fileArg(argv) {
  const index = argv.indexOf('--file');
  if (index < 0 || !argv[index + 1]) throw new Error('Use --file <ruta.xlsx>.');
  return argv[index + 1];
}

const file = fileArg(process.argv.slice(2));
const analysis = await analyzeWorkbook(file);
const grouped = new Map();

for (const anomaly of analysis.anomalies) {
  const key = JSON.stringify({
    type: anomaly.type,
    sheet: anomaly.sheet || '',
    column: anomaly.column || '',
    referenceTable: anomaly.referenceTable || '',
    parentColumn: anomaly.detail?.parentColumn || '',
  });
  grouped.set(key, Number(grouped.get(key) || 0) + 1);
}

const breakdown = [...grouped.entries()]
  .map(([key, count]) => ({ ...JSON.parse(key), count }))
  .sort((a, b) => b.count - a.count
    || a.type.localeCompare(b.type)
    || a.sheet.localeCompare(b.sheet)
    || a.column.localeCompare(b.column));

const structuralTypes = new Set(['UNEXPECTED_SHEET', 'MISSING_SHEET', 'UNEXPECTED_COLUMN', 'MISSING_COLUMN']);
const structuralAnomalies = breakdown.filter((item) => structuralTypes.has(item.type));

console.log(JSON.stringify({
  sourceSha256: analysis.file.sha256,
  sheets: analysis.workbook.sheetCount,
  sourceRows: analysis.workbook.sourceRows,
  anomalyCount: analysis.anomalies.length,
  structuralSafe: structuralAnomalies.length === 0,
  structuralAnomalies,
  breakdown,
}, null, 2));

if (structuralAnomalies.length) process.exitCode = 1;
