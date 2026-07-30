import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function includesAll(contents, fragments) {
  fragments.forEach((fragment) => assert.ok(
    contents.includes(fragment),
    `Falta el contrato de caracterización: ${fragment}`,
  ));
}

test('App conserva carga diferida, recuperación global y offline opcional', () => {
  const contents = source('src/app/App.jsx');
  includesAll(contents, [
    "const FormRecoveryManager = lazy(() => import('../components/offline/FormRecoveryManager'))",
    'function FormRecoveryRuntime()',
    'function OptionalOfflineRuntime()',
    '<FormRecoveryRuntime />',
    '<OptionalOfflineRuntime />',
    'const TicketFormPage = lazyPage',
    'const MaintenanceFormPage = lazyPage',
  ]);
});

test('las rutas críticas del frontend mantienen sus permisos actuales', () => {
  const contents = source('src/app/App.jsx');
  includesAll(contents, [
    'path="boletas/pendientes"',
    'permission="BOLETAS_VER"',
    'path="boletas/nueva"',
    'permission="BOLETAS_CREAR"',
    'path="boletas/:boletaUid/editar"',
    'permission="BOLETAS_EDITAR"',
    'path="mantenimientos"',
    'anyOf={MAINTENANCE_VIEW}',
    'path="mantenimientos/nuevo"',
    'anyOf={MAINTENANCE_CREATE}',
    'path="mantenimientos/:maintenanceId/editar"',
    'anyOf={MAINTENANCE_EDIT}',
  ]);
});

test('el backend conserva permisos de cierre, evidencias y rutas públicas', () => {
  const contents = source('backend/src/core/action-router.js');
  includesAll(contents, [
    "else if(key==='finalize') permission='BOLETAS_FINALIZAR';",
    "permission=['BOLETAS_EVIDENCIAS','BOLETAS_EDITAR']",
    "add(['survey.public.get','encuesta.publica.get'], surveyHandlers.publicGet, null, true);",
    "add(['ticket.signature.public.get','boletas.firma.publica.get'], publicSignatureHandlers.publicGet, null, true);",
    "add(['maintenance.signature.public.get','mantenimientos.firma.publica.get'], publicSignatureHandlers.publicGet, null, true);",
    "if(entry.permission){const required=Array.isArray(entry.permission)?entry.permission:[entry.permission]",
  ]);
});

test('la capa HTTP mantiene deduplicación, caché corta, reintentos y cancelación', () => {
  const contents = source('src/api.js');
  includesAll(contents, [
    'const READ_CACHE_MS = 15_000;',
    'const READ_STALE_MS = 5 * 60_000;',
    'const TRANSIENT_RETRY_DELAYS_MS = [700, 1500, 2800];',
    'const pendingReads = new Map();',
    'if (!signal && pendingReads.has(key)) return pendingReads.get(key);',
    'signal,',
    'await wait(TRANSIENT_RETRY_DELAYS_MS[attempt], signal);',
  ]);
});

test('moduleApi delega reintentos y aliases a una sola infraestructura', () => {
  const contents = source('src/services/moduleApi.js');
  includesAll(contents, [
    "import { requestFirstAvailable } from './aliasResolver';",
    'export async function requestAvailable(routes, payload = {}, sessionToken = \'\', options = {})',
    'const result = await requestFirstAvailable(',
    '(route) => apiRequest(route, preparedPayload, sessionToken, options)',
  ]);
  assert.equal(contents.includes('requestRouteWithRetry'), false, 'moduleApi no debe mantener un segundo ciclo de reintentos');
  assert.equal(contents.includes('await wait(450)'), false, 'moduleApi no debe agregar otra pausa de red');
});

test('la recuperación mantiene IndexedDB, respaldo local y límites de limpieza', () => {
  const contents = source('src/services/draftStore.js');
  includesAll(contents, [
    "const DB_NAME = 'dms-boletas-form-drafts';",
    'const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;',
    'const MAX_DRAFTS = 60;',
    'export async function saveDraft(entry)',
    'export async function loadDraft(key)',
    'export async function pruneDrafts()',
  ]);
});

test('el servidor conserva compresión, Helmet, CSP activa y límites de payload', () => {
  const contents = source('backend/src/app.js');
  includesAll(contents, [
    "app.disable('x-powered-by');",
    'app.use(helmet({',
    'contentSecurityPolicy: {',
    'objectSrc: ["\'none\'"]',
    "app.use(express.json({ limit: '25mb' }));",
    'app.use(compression({ threshold: 1_024 }));',
  ]);
  assert.equal(contents.includes('contentSecurityPolicy: false'), false, 'CSP no debe volver a deshabilitarse');
});
