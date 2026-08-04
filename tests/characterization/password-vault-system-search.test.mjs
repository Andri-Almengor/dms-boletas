import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  credentialSystemRequestIntent,
  detectCredentialSystemReference,
  matchCredentialSystemRows,
  normalizeVaultSearch,
} from '../../backend/src/services/password-vault-system-search.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const categories = new Map([
  ['access', { CategoriaCredencialID: 'access', Nombre: 'Control de acceso' }],
  ['vms', { CategoriaCredencialID: 'vms', Nombre: 'Cámaras y videovigilancia' }],
  ['display', { CategoriaCredencialID: 'display', Nombre: 'Videowall' }],
  ['identity', { CategoriaCredencialID: 'identity', Nombre: 'Identidad' }],
]);

const rows = [
  { CredencialID: 'onguard', ClienteID: 'asamblea', CategoriaCredencialID: 'access', Nombre: 'LenelS2 OnGuard', Usuario: 'Admin', Activo: true },
  { CredencialID: 'milestone', ClienteID: 'asamblea', CategoriaCredencialID: 'vms', Nombre: 'Milestone XProtect', Usuario: 'Administrador', Activo: true },
  { CredencialID: 'axis', ClienteID: 'afz', CategoriaCredencialID: 'vms', Nombre: 'Axis Camera Station', Usuario: 'root', Activo: true },
  { CredencialID: 'ipro', ClienteID: 'afz', CategoriaCredencialID: 'vms', Nombre: 'i-PRO Video Management', Usuario: 'admin', Activo: true },
  { CredencialID: 'barco', ClienteID: 'rn', CategoriaCredencialID: 'display', Nombre: 'Barco CTRL', Usuario: 'operator', Activo: true },
  { CredencialID: 'morpho', ClienteID: 'rn', CategoriaCredencialID: 'identity', Nombre: 'MorphoManager', Usuario: 'admin', Activo: true },
];

function matchedIds(question) {
  return matchCredentialSystemRows(question, rows, categories).map((item) => item.row.CredencialID);
}

test('normaliza marcas con guiones y acentos para una búsqueda consistente', () => {
  assert.equal(normalizeVaultSearch('Cámaras i-PRO'), 'camaras i pro');
  assert.equal(normalizeVaultSearch('LenelS2 / OnGuard'), 'lenels2 onguard');
});

test('OnGuard y Lenel se consideran el mismo grupo de sistema', () => {
  assert.equal(detectCredentialSystemReference('Dame la contraseña de OnGuard')?.key, 'lenel-onguard');
  assert.equal(detectCredentialSystemReference('Cuál es la clave de Lenel')?.key, 'lenel-onguard');
  assert.deepEqual(matchedIds('Dame la contraseña de OnGuard'), ['onguard']);
  assert.deepEqual(matchedIds('Dame la contraseña de Lenel'), ['onguard']);
});

test('reconoce Milestone y XProtect como referencias equivalentes', () => {
  assert.equal(detectCredentialSystemReference('Contraseña de Milestone')?.key, 'milestone-xprotect');
  assert.equal(detectCredentialSystemReference('Usuario de XProtect')?.key, 'milestone-xprotect');
  assert.deepEqual(matchedIds('Contraseña de Milestone'), ['milestone']);
  assert.deepEqual(matchedIds('Usuario de XProtect'), ['milestone']);
});

test('reconoce cámaras Axis, cámaras i-PRO y Barco', () => {
  assert.deepEqual(matchedIds('Dame las credenciales de las cámaras Axis'), ['axis']);
  assert.deepEqual(matchedIds('Lista los usuarios de cámaras iPRO'), ['ipro']);
  assert.deepEqual(matchedIds('Dame la contraseña de Barco'), ['barco']);
});

test('también busca cualquier nombre dinámico guardado como sistema o servicio', () => {
  assert.equal(detectCredentialSystemReference('Contraseña de MorphoManager'), null);
  assert.deepEqual(matchedIds('Contraseña de MorphoManager'), ['morpho']);
  assert.equal(credentialSystemRequestIntent('Contraseña de MorphoManager', rows, categories), true);
});

test('una consulta genérica por cliente continúa usando el flujo anterior', () => {
  assert.equal(credentialSystemRequestIntent('Dame las credenciales de AFZ', rows, categories), false);
});

test('la capa del asistente resuelve cliente único, pide aclaración y nunca usa Gemini', () => {
  const patch = source('backend/src/services/password-vault-system-assistant.patch.js');
  const app = source('backend/src/app.js');

  assert.match(patch, /uniqueClientsFromMatches/);
  assert.match(patch, /matchingClients\.length === 1/);
  assert.match(patch, /varios clientes[\s\S]*Seleccione el cliente correcto/);
  assert.match(patch, /contextClient/);
  assert.match(patch, /queryPasswordVaultForAssistant/);
  assert.match(patch, /sensitive:\s*rows\.length > 0/);
  assert.match(patch, /secretsSentToGemini:\s*false/);
  assert.doesNotMatch(patch, /gemini\.service|generateContent|GoogleGenerativeAI/);
  assert.match(app, /password-vault-assistant\.patch\.js[\s\S]*password-vault-system-assistant\.patch\.js/);
});
