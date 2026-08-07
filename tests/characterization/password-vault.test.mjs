import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

process.env.PASSWORD_VAULT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const {
  decryptVaultSecret,
  encryptVaultSecret,
  PASSWORD_VAULT_CRYPTO,
  vaultEncryptionConfigured,
} = await import('../../backend/src/services/password-vault-crypto.service.js');

const IDENTITY = Object.freeze({
  credentialId: 'credencial-prueba',
  clientId: 'cliente-prueba',
  categoryId: 'categoria-prueba',
});

test('las contraseñas se cifran con AES-256-GCM y no quedan en texto plano', () => {
  const secret = 'Password-Muy-Seguro-2026!';
  const encrypted = encryptVaultSecret(secret, IDENTITY);
  assert.equal(PASSWORD_VAULT_CRYPTO.algorithm, 'aes-256-gcm');
  assert.equal(PASSWORD_VAULT_CRYPTO.ivBytes, 12);
  assert.equal(encrypted.PasswordVersion, 'v1');
  assert.notEqual(encrypted.PasswordCiphertext, secret);
  assert.ok(!JSON.stringify(encrypted).includes(secret));
  assert.equal(decryptVaultSecret({
    CredencialID: IDENTITY.credentialId,
    ClienteID: IDENTITY.clientId,
    CategoriaCredencialID: IDENTITY.categoryId,
    ...encrypted,
  }), secret);
  assert.equal(vaultEncryptionConfigured(), true);
});

test('la autenticación GCM rechaza una credencial manipulada o movida de cliente', () => {
  const encrypted = encryptVaultSecret('secreto', IDENTITY);
  const record = {
    CredencialID: IDENTITY.credentialId,
    ClienteID: IDENTITY.clientId,
    CategoriaCredencialID: IDENTITY.categoryId,
    ...encrypted,
  };
  const tampered = {
    ...record,
    PasswordTag: Buffer.alloc(16, 3).toString('base64'),
  };
  assert.throws(() => decryptVaultSecret(tampered), /No fue posible descifrar/);
  assert.throws(() => decryptVaultSecret({ ...record, ClienteID: 'otro-cliente' }), /No fue posible descifrar/);
});

test('el esquema guarda únicamente material cifrado y registra las tablas', () => {
  const schema = source('backend/src/services/password-vault-schema.service.js');
  const tables = source('backend/src/config/tables.js');
  assert.match(schema, /CategoriasCredenciales/);
  assert.match(schema, /CredencialesClientes/);
  assert.match(schema, /PasswordCiphertext/);
  assert.match(schema, /PasswordIV/);
  assert.match(schema, /PasswordTag/);
  assert.doesNotMatch(schema, /'Password',/);
  assert.match(tables, /CategoriasCredenciales:\s*\{ id: 'CategoriaCredencialID' \}/);
  assert.match(tables, /CredencialesClientes:\s*\{ id: 'CredencialID' \}/);
});

test('administradores gestionan y técnicos autorizados consultan sin recibir ciphertext', () => {
  const module = source('backend/src/modules/password-vault.module.js');
  assert.match(module, /USUARIOS_GESTIONAR/);
  assert.match(module, /BOLETAS_VER/);
  assert.match(module, /MANTENIMIENTOS_VER/);
  assert.match(module, /passwordMasked:\s*'••••••••••••'/);
  assert.match(module, /REVELAR_CREDENCIAL_CLIENTE/);
  assert.match(module, /CONSULTAR_CREDENCIALES_ASISTENTE/);
  assert.match(module, /CREAR_CATEGORIA_CREDENCIAL/);
  assert.match(module, /ELIMINAR_CREDENCIAL_CLIENTE/);
  assert.match(module, /auditCredentialView/);
  const auditView = module.match(/function auditCredentialView[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(auditView, /\bPasswordCiphertext\s*:/);
  assert.doesNotMatch(auditView, /\bPasswordIV\s*:/);
  assert.doesNotMatch(auditView, /\bPasswordTag\s*:/);
  assert.match(auditView, /PasswordConfigurado/);
});

test('el asistente resuelve credenciales sin enviarlas a Gemini y resume casos', () => {
  const patch = source('backend/src/services/password-vault-assistant.patch.js');
  const app = source('backend/src/app.js');
  assert.match(app, /password-vault-assistant\.patch/);
  assert.match(patch, /queryPasswordVaultForAssistant/);
  assert.match(patch, /credentialIntent/);
  assert.match(patch, /caseIntent/);
  assert.match(patch, /unassigned/);
  assert.match(patch, /newToday/);
  assert.match(patch, /sensitive:\s*rows\.length > 0/);
  assert.match(patch, /secretsSentToGemini:\s*false/);
  assert.doesNotMatch(patch, /from ['"].*gemini.*['"]/i);
  assert.doesNotMatch(patch, /generateContent|generateInitialCaseEmail|generateAssignedCaseEmail/);
});

test('la interfaz es desplegable, oculta secretos y separa acciones de los botones', () => {
  const page = source('src/pages/security/PasswordVaultPage.jsx');
  const styles = source('src/styles/password-vault.css');
  const accessibility = source('src/styles/password-vault-accessibility.css');
  assert.match(page, /aria-expanded=\{clientOpen\}/);
  assert.match(page, /aria-expanded=\{categoryOpen\}/);
  assert.match(page, /password-vault-client__heading/);
  assert.match(page, /password-vault-client__add/);
  assert.doesNotMatch(page, /password-vault-accordion-trigger__right/);
  assert.match(page, /document\.visibilityState === 'hidden'/);
  assert.match(page, /expiresInSeconds \|\| 30/);
  assert.match(styles, /password-vault-credential-grid/);
  assert.match(styles, /\[data-theme='dark'\] \.password-vault-page/);
  assert.match(accessibility, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
});

test('las respuestas sensibles no se guardan en el historial local del asistente', () => {
  const assistant = source('src/pages/assistant/AssistantPageSecure.jsx');
  assert.match(assistant, /messages\.filter\(\(item\) => !item\.sensitive\)/);
  assert.match(assistant, /filter\(\(item\) => !item\.sensitive &&/);
  assert.match(assistant, /AssistantSecretCell/);
  assert.match(assistant, /30_000/);
  assert.match(assistant, /Esta respuesta contiene información sensible/);
  assert.match(assistant, /los secretos no se envían a Gemini/);
});

test('el módulo se puede abrir desde Más, clientes y una ruta protegida', () => {
  const app = source('src/app/App.jsx');
  const more = source('src/pages/MorePage.jsx');
  const clients = source('src/pages/admin/ClientsPage.jsx');
  assert.match(app, /path="credenciales"/);
  assert.match(app, /PASSWORD_VAULT_VIEW/);
  assert.match(more, /to="\/credenciales"/);
  assert.match(more, /Contraseñas de clientes/);
  assert.match(clients, /\/credenciales\?cliente=/);
  assert.match(clients, /Contraseñas del cliente/);
});
