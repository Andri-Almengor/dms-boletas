import { sheetsApi } from '../infra/google.js';

const INSTALL_FLAG = Symbol.for('dms.sheetsMemoryGuard');
const DEFAULT_MAX_RANGES = 3;
const MIN_RANGES = 1;
const MAX_RANGES = 8;

const HEAVY_SHEETS = new Set([
  'Boletas',
  'EvidenciasBoleta',
  'Mantenimiento',
  'Evidencia_Mantenimientos',
  'Mantenimiento imagenes',
  'MaintenanceFinalizationJobs',
  'MaintenanceFinalizationItems',
  'KnowledgeArticles',
  'KnowledgeArticleContent',
  'CasoEvidencias',
  'EncuestaRespuestas',
  'Auditoria',
  'ActividadApp',
]);

let repositoryReadTail = Promise.resolve();

function configuredMaxRanges() {
  const parsed = Number.parseInt(String(process.env.SHEETS_REPOSITORY_BATCH_MAX_RANGES || ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RANGES;
  return Math.min(MAX_RANGES, Math.max(MIN_RANGES, parsed));
}

function sheetNameFromRange(range) {
  const raw = String(range || '').split('!', 1)[0].trim();
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function isRepositoryRange(range) {
  return /!A:ZZ$/i.test(String(range || '').trim());
}

function isRepositoryBatchGet(args = {}) {
  const ranges = Array.isArray(args.ranges) ? args.ranges : [];
  return args.valueRenderOption === 'UNFORMATTED_VALUE'
    && ranges.length > 0
    && ranges.every(isRepositoryRange);
}

function splitRepositoryRanges(ranges = [], maxRanges = configuredMaxRanges()) {
  const batches = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    batches.push(current);
    current = [];
  };

  for (const range of ranges) {
    if (HEAVY_SHEETS.has(sheetNameFromRange(range))) {
      flush();
      batches.push([range]);
      continue;
    }
    current.push(range);
    if (current.length >= maxRanges) flush();
  }
  flush();
  return batches;
}

function yieldForMemoryRecovery() {
  return new Promise((resolve) => setImmediate(() => {
    try { global.gc?.(); } catch { /* GC explícito es opcional. */ }
    resolve();
  }));
}

function serializeRepositoryRead(operation) {
  const run = repositoryReadTail.then(operation, operation);
  // La cola nunca conserva el valor (potencialmente grande) de la lectura anterior.
  repositoryReadTail = run.then(() => undefined, () => undefined);
  return run;
}

export function installSheetsMemoryGuard() {
  if (sheetsApi[INSTALL_FLAG]) return;

  const originalBatchGet = sheetsApi.spreadsheets.values.batchGet.bind(sheetsApi.spreadsheets.values);
  sheetsApi.spreadsheets.values.batchGet = async function boundedRepositoryBatchGet(args = {}) {
    if (!isRepositoryBatchGet(args)) return originalBatchGet(args);

    return serializeRepositoryRead(async () => {
      const ranges = Array.isArray(args.ranges) ? args.ranges : [];
      const batches = splitRepositoryRanges(ranges);
      if (batches.length <= 1) return originalBatchGet(args);

      const valueRanges = [];
      let spreadsheetId = '';
      for (const batch of batches) {
        const response = await originalBatchGet({ ...args, ranges: batch });
        spreadsheetId ||= String(response?.data?.spreadsheetId || '');
        valueRanges.push(...(response?.data?.valueRanges || []));
        // No conservamos el objeto response entre lotes. Así los buffers del
        // transporte HTTP pueden ser recolectados antes de pedir el siguiente.
        await yieldForMemoryRecovery();
      }

      return {
        data: {
          spreadsheetId,
          valueRanges,
        },
      };
    });
  };

  Object.defineProperty(sheetsApi, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export const SHEETS_MEMORY_GUARD_POLICY = Object.freeze({
  defaultMaxRanges: DEFAULT_MAX_RANGES,
  heavySheets: [...HEAVY_SHEETS],
  repositoryRangePattern: '!A:ZZ',
  serialFullTableReads: true,
});

installSheetsMemoryGuard();
