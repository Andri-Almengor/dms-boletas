import { authenticate } from '../services/auth.service.js';
import { badRequest, forbidden, notFound } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import {
  appendRow,
  findById,
  readTables,
  updateRow,
} from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import {
  decryptVaultSecret,
  encryptVaultSecret,
  vaultEncryptionConfigured,
} from '../services/password-vault-crypto.service.js';
import { ensurePasswordVaultSchema } from '../services/password-vault-schema.service.js';

const READ_PERMISSIONS = Object.freeze([
  'CLIENTES_VER',
  'BOLETAS_VER',
  'MANTENIMIENTOS_VER',
  'MANTENIMIENTOS_CREAR',
  'MANTENIMIENTOS_EDITAR',
  'MANTENIMIENTOS_GESTIONAR',
]);

const ROUTES = new Map();

function add(names, handler) {
  for (const name of Array.isArray(names) ? names : [names]) ROUTES.set(name, handler);
}

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function rawSecret(payload = {}) {
  const value = Object.prototype.hasOwnProperty.call(payload, 'password')
    ? payload.password
    : Object.prototype.hasOwnProperty.call(payload, 'Password')
      ? payload.Password
      : undefined;
  if (value === undefined || value === null) return undefined;
  return String(value).slice(0, 4096);
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function booleanValue(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'activo'].includes(clean(value, 20).toLowerCase());
}

function active(row = {}) {
  return row.Activo !== false
    && clean(row.Activo ?? 'true', 20).toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo';
}

export function canManagePasswordVault(ctx = {}) {
  return (ctx.permissions || []).includes('USUARIOS_GESTIONAR');
}

export function canReadPasswordVault(ctx = {}) {
  const permissions = new Set(ctx.permissions || []);
  return permissions.has('USUARIOS_GESTIONAR')
    || READ_PERMISSIONS.some((permission) => permissions.has(permission));
}

function assertCanRead(ctx) {
  if (!canReadPasswordVault(ctx)) {
    throw forbidden('No cuenta con permiso para consultar las credenciales de clientes.');
  }
}

function assertCanManage(ctx) {
  if (!canManagePasswordVault(ctx)) {
    throw forbidden('Solo un administrador puede crear, editar o eliminar credenciales.');
  }
}

function clientName(row = {}) {
  return clean(pick(row, ['Clientes', 'Cliente', 'Nombre', 'RazonSocial'], 'Cliente'), 250);
}

function categoryView(row = {}, count = 0) {
  return {
    id: clean(row.CategoriaCredencialID, 220),
    name: clean(row.Nombre, 180),
    description: clean(row.Descripcion, 1200),
    status: clean(row.Estado || 'ACTIVO', 40).toUpperCase(),
    active: active(row),
    credentialCount: Number(count || 0),
    createdAt: clean(row.FechaCreacion, 80),
    updatedAt: clean(row.FechaActualizacion, 80),
  };
}

function credentialView(row = {}, clientsById = new Map(), categoriesById = new Map()) {
  const client = clientsById.get(clean(row.ClienteID, 220)) || {};
  const category = categoriesById.get(clean(row.CategoriaCredencialID, 220)) || {};
  return {
    id: clean(row.CredencialID, 220),
    clientId: clean(row.ClienteID, 220),
    clientName: clientName(client),
    categoryId: clean(row.CategoriaCredencialID, 220),
    categoryName: clean(category.Nombre, 180) || 'Sin categoría',
    name: clean(row.Nombre, 250),
    username: clean(row.Usuario, 500),
    url: clean(row.URL, 2000),
    notes: clean(row.Notas, 4000),
    passwordMasked: '••••••••••••',
    hasPassword: Boolean(clean(row.PasswordCiphertext, 20000)),
    version: Number(row.Version || 1),
    active: active(row),
    createdAt: clean(row.FechaCreacion, 80),
    updatedAt: clean(row.FechaActualizacion, 80),
  };
}

function auditCredentialView(row = {}) {
  return {
    CredencialID: clean(row.CredencialID, 220),
    ClienteID: clean(row.ClienteID, 220),
    CategoriaCredencialID: clean(row.CategoriaCredencialID, 220),
    Nombre: clean(row.Nombre, 250),
    Usuario: clean(row.Usuario, 500),
    URL: clean(row.URL, 2000),
    Notas: clean(row.Notas, 4000),
    Version: Number(row.Version || 1),
    Activo: active(row),
    PasswordConfigurado: Boolean(clean(row.PasswordCiphertext, 20000)),
  };
}

function categoryInput(payload = {}, existing = {}) {
  const name = clean(pick(payload, ['name', 'Nombre'], existing.Nombre), 180);
  if (!name) throw badRequest('El nombre de la categoría es obligatorio.');
  return {
    Nombre: name,
    Descripcion: clean(pick(payload, ['description', 'Descripcion'], existing.Descripcion), 1200),
    Estado: clean(pick(payload, ['status', 'Estado'], existing.Estado || 'ACTIVO'), 40).toUpperCase(),
    Activo: booleanValue(pick(payload, ['active', 'Activo'], existing.Activo ?? true), true),
  };
}

function credentialInput(payload = {}, existing = {}) {
  const clientId = clean(pick(payload, ['clientId', 'ClienteID'], existing.ClienteID), 220);
  const categoryId = clean(pick(payload, ['categoryId', 'CategoriaCredencialID'], existing.CategoriaCredencialID), 220);
  const name = clean(pick(payload, ['name', 'Nombre'], existing.Nombre), 250);
  const username = clean(pick(payload, ['username', 'Usuario'], existing.Usuario), 500);
  if (!clientId) throw badRequest('Seleccione un cliente.');
  if (!categoryId) throw badRequest('Seleccione una categoría.');
  if (!name) throw badRequest('El nombre del sistema o servicio es obligatorio.');
  if (!username) throw badRequest('El usuario es obligatorio.');
  return {
    ClienteID: clientId,
    CategoriaCredencialID: categoryId,
    Nombre: name,
    Usuario: username,
    URL: clean(pick(payload, ['url', 'URL'], existing.URL), 2000),
    Notas: clean(pick(payload, ['notes', 'Notas'], existing.Notas), 4000),
    Activo: booleanValue(pick(payload, ['active', 'Activo'], existing.Activo ?? true), true),
  };
}

async function validateClientAndCategory(clientId, categoryId) {
  const tables = await readTables(['Clientes', 'CategoriasCredenciales']);
  const client = tables.Clientes.find((row) => clean(row.ClienteID, 220) === clientId && active(row));
  if (!client) throw notFound('El cliente seleccionado no existe o está inactivo.');
  const category = tables.CategoriasCredenciales.find((row) => clean(row.CategoriaCredencialID, 220) === categoryId && active(row));
  if (!category) throw notFound('La categoría seleccionada no existe o está inactiva.');
  return { client, category };
}

async function assertUniqueCategory(name, ignoredId = '') {
  const { CategoriasCredenciales = [] } = await readTables(['CategoriasCredenciales']);
  const duplicate = CategoriasCredenciales.find((row) => (
    active(row)
    && clean(row.CategoriaCredencialID, 220) !== ignoredId
    && normalized(row.Nombre) === normalized(name)
  ));
  if (duplicate) throw badRequest('Ya existe una categoría con ese nombre.');
}

async function assertUniqueCredential(input, ignoredId = '') {
  const { CredencialesClientes = [] } = await readTables(['CredencialesClientes']);
  const duplicate = CredencialesClientes.find((row) => (
    active(row)
    && clean(row.CredencialID, 220) !== ignoredId
    && clean(row.ClienteID, 220) === input.ClienteID
    && clean(row.CategoriaCredencialID, 220) === input.CategoriaCredencialID
    && normalized(row.Nombre) === normalized(input.Nombre)
    && normalized(row.Usuario) === normalized(input.Usuario)
  ));
  if (duplicate) {
    throw badRequest('Ya existe una credencial activa para ese sistema y usuario dentro de la categoría seleccionada.');
  }
}

async function dashboard(ctx) {
  assertCanRead(ctx);
  await ensurePasswordVaultSchema();
  const includeInactive = canManagePasswordVault(ctx) && booleanValue(ctx.payload.includeInactive, false);
  const requestedClientId = clean(pick(ctx.payload, ['clientId', 'ClienteID']), 220);
  const requestedCategoryId = clean(pick(ctx.payload, ['categoryId', 'CategoriaCredencialID']), 220);
  const search = normalized(pick(ctx.payload, ['search', 'q'], ''));
  const tables = await readTables(['Clientes', 'CategoriasCredenciales', 'CredencialesClientes']);
  const clients = tables.Clientes
    .filter((row) => includeInactive || active(row))
    .sort((left, right) => clientName(left).localeCompare(clientName(right), 'es'));
  const categories = tables.CategoriasCredenciales
    .filter((row) => includeInactive || active(row))
    .sort((left, right) => clean(left.Nombre).localeCompare(clean(right.Nombre), 'es'));
  const clientsById = new Map(clients.map((row) => [clean(row.ClienteID, 220), row]));
  const categoriesById = new Map(categories.map((row) => [clean(row.CategoriaCredencialID, 220), row]));
  let credentials = tables.CredencialesClientes.filter((row) => includeInactive || active(row));
  if (requestedClientId) credentials = credentials.filter((row) => clean(row.ClienteID, 220) === requestedClientId);
  if (requestedCategoryId) credentials = credentials.filter((row) => clean(row.CategoriaCredencialID, 220) === requestedCategoryId);
  let views = credentials.map((row) => credentialView(row, clientsById, categoriesById));
  if (search) {
    views = views.filter((row) => normalized([
      row.clientName,
      row.categoryName,
      row.name,
      row.username,
      row.url,
      row.notes,
    ].join(' ')).includes(search));
  }
  views.sort((left, right) => (
    left.clientName.localeCompare(right.clientName, 'es')
    || left.categoryName.localeCompare(right.categoryName, 'es')
    || left.name.localeCompare(right.name, 'es')
  ));
  const countByCategory = new Map();
  const countByClient = new Map();
  for (const row of tables.CredencialesClientes.filter(active)) {
    countByCategory.set(clean(row.CategoriaCredencialID, 220), (countByCategory.get(clean(row.CategoriaCredencialID, 220)) || 0) + 1);
    countByClient.set(clean(row.ClienteID, 220), (countByClient.get(clean(row.ClienteID, 220)) || 0) + 1);
  }
  return {
    canManage: canManagePasswordVault(ctx),
    encryptionConfigured: vaultEncryptionConfigured(),
    clients: clients.map((row) => ({
      id: clean(row.ClienteID, 220),
      name: clientName(row),
      status: clean(row.Estado || 'ACTIVO', 40).toUpperCase(),
      active: active(row),
      credentialCount: Number(countByClient.get(clean(row.ClienteID, 220)) || 0),
    })),
    categories: categories.map((row) => categoryView(row, countByCategory.get(clean(row.CategoriaCredencialID, 220)) || 0)),
    credentials: views,
    total: views.length,
  };
}

async function createCategory(ctx) {
  assertCanManage(ctx);
  await ensurePasswordVaultSchema();
  const input = categoryInput(ctx.payload);
  await assertUniqueCategory(input.Nombre);
  const timestamp = nowIso();
  const row = {
    CategoriaCredencialID: uuid(),
    ...input,
    FechaCreacion: timestamp,
    FechaActualizacion: timestamp,
    CreadoPor: ctx.user.UsuarioID,
    ActualizadoPor: ctx.user.UsuarioID,
  };
  await appendRow('CategoriasCredenciales', row);
  await audit(ctx, 'CREAR_CATEGORIA_CREDENCIAL', 'CategoriasCredenciales', row.CategoriaCredencialID, null, categoryView(row));
  return categoryView(row);
}

async function updateCategory(ctx) {
  assertCanManage(ctx);
  await ensurePasswordVaultSchema();
  const id = clean(pick(ctx.payload, ['id', 'categoryId', 'CategoriaCredencialID']), 220);
  const before = await findById('CategoriasCredenciales', id);
  const input = categoryInput(ctx.payload, before);
  await assertUniqueCategory(input.Nombre, id);
  const after = await updateRow('CategoriasCredenciales', id, {
    ...input,
    FechaActualizacion: nowIso(),
    ActualizadoPor: ctx.user.UsuarioID,
  });
  await audit(ctx, 'ACTUALIZAR_CATEGORIA_CREDENCIAL', 'CategoriasCredenciales', id, categoryView(before), categoryView(after));
  return categoryView(after);
}

async function deleteCategory(ctx) {
  assertCanManage(ctx);
  await ensurePasswordVaultSchema();
  const id = clean(pick(ctx.payload, ['id', 'categoryId', 'CategoriaCredencialID']), 220);
  const before = await findById('CategoriasCredenciales', id);
  const { CredencialesClientes = [] } = await readTables(['CredencialesClientes']);
  const used = CredencialesClientes.filter((row) => active(row) && clean(row.CategoriaCredencialID, 220) === id);
  if (used.length) {
    throw badRequest(`No se puede eliminar la categoría porque contiene ${used.length} credencial${used.length === 1 ? '' : 'es'} activa${used.length === 1 ? '' : 's'}.`);
  }
  const after = await updateRow('CategoriasCredenciales', id, {
    Estado: 'INACTIVO',
    Activo: false,
    FechaActualizacion: nowIso(),
    ActualizadoPor: ctx.user.UsuarioID,
  });
  await audit(ctx, 'ELIMINAR_CATEGORIA_CREDENCIAL', 'CategoriasCredenciales', id, categoryView(before), categoryView(after));
  return { deleted: true, category: categoryView(after) };
}

async function createCredential(ctx) {
  assertCanManage(ctx);
  await ensurePasswordVaultSchema();
  const input = credentialInput(ctx.payload);
  const password = rawSecret(ctx.payload);
  if (!password) throw badRequest('La contraseña es obligatoria.');
  await validateClientAndCategory(input.ClienteID, input.CategoriaCredencialID);
  await assertUniqueCredential(input);
  const id = uuid();
  const timestamp = nowIso();
  const encrypted = encryptVaultSecret(password, {
    credentialId: id,
    clientId: input.ClienteID,
    categoryId: input.CategoriaCredencialID,
  });
  const row = {
    CredencialID: id,
    ...input,
    ...encrypted,
    Version: 1,
    FechaCreacion: timestamp,
    FechaActualizacion: timestamp,
    CreadoPor: ctx.user.UsuarioID,
    ActualizadoPor: ctx.user.UsuarioID,
  };
  await appendRow('CredencialesClientes', row);
  await audit(ctx, 'CREAR_CREDENCIAL_CLIENTE', 'CredencialesClientes', id, null, auditCredentialView(row));
  const tables = await readTables(['Clientes', 'CategoriasCredenciales']);
  return credentialView(
    row,
    new Map(tables.Clientes.map((item) => [clean(item.ClienteID, 220), item])),
    new Map(tables.CategoriasCredenciales.map((item) => [clean(item.CategoriaCredencialID, 220), item])),
  );
}

async function updateCredential(ctx) {
  assertCanManage(ctx);
  await ensurePasswordVaultSchema();
  const id = clean(pick(ctx.payload, ['id', 'credentialId', 'CredencialID']), 220);
  const before = await findById('CredencialesClientes', id);
  const input = credentialInput(ctx.payload, before);
  await validateClientAndCategory(input.ClienteID, input.CategoriaCredencialID);
  await assertUniqueCredential(input, id);
  const suppliedPassword = rawSecret(ctx.payload);
  const identityChanged = input.ClienteID !== clean(before.ClienteID, 220)
    || input.CategoriaCredencialID !== clean(before.CategoriaCredencialID, 220);
  let encrypted = {};
  let secretChanged = false;
  if (suppliedPassword !== undefined && suppliedPassword !== '') {
    encrypted = encryptVaultSecret(suppliedPassword, {
      credentialId: id,
      clientId: input.ClienteID,
      categoryId: input.CategoriaCredencialID,
    });
    secretChanged = true;
  } else if (identityChanged) {
    encrypted = encryptVaultSecret(decryptVaultSecret(before), {
      credentialId: id,
      clientId: input.ClienteID,
      categoryId: input.CategoriaCredencialID,
    });
  }
  const after = await updateRow('CredencialesClientes', id, {
    ...input,
    ...encrypted,
    Version: Number(before.Version || 1) + 1,
    FechaActualizacion: nowIso(),
    ActualizadoPor: ctx.user.UsuarioID,
  });
  await audit(ctx, 'ACTUALIZAR_CREDENCIAL_CLIENTE', 'CredencialesClientes', id, auditCredentialView(before), {
    ...auditCredentialView(after),
    PasswordModificado: secretChanged,
  });
  const tables = await readTables(['Clientes', 'CategoriasCredenciales']);
  return credentialView(
    after,
    new Map(tables.Clientes.map((item) => [clean(item.ClienteID, 220), item])),
    new Map(tables.CategoriasCredenciales.map((item) => [clean(item.CategoriaCredencialID, 220), item])),
  );
}

async function deleteCredential(ctx) {
  assertCanManage(ctx);
  await ensurePasswordVaultSchema();
  const id = clean(pick(ctx.payload, ['id', 'credentialId', 'CredencialID']), 220);
  const before = await findById('CredencialesClientes', id);
  const after = await updateRow('CredencialesClientes', id, {
    Activo: false,
    FechaActualizacion: nowIso(),
    ActualizadoPor: ctx.user.UsuarioID,
  });
  await audit(ctx, 'ELIMINAR_CREDENCIAL_CLIENTE', 'CredencialesClientes', id, auditCredentialView(before), auditCredentialView(after));
  return { deleted: true, credentialId: id };
}

async function revealCredential(ctx) {
  assertCanRead(ctx);
  await ensurePasswordVaultSchema();
  const id = clean(pick(ctx.payload, ['id', 'credentialId', 'CredencialID']), 220);
  const row = await findById('CredencialesClientes', id);
  if (!active(row)) throw notFound('La credencial no está disponible.');
  const password = decryptVaultSecret(row);
  await audit(ctx, 'REVELAR_CREDENCIAL_CLIENTE', 'CredencialesClientes', id, null, {
    CredencialID: id,
    ClienteID: clean(row.ClienteID, 220),
    CategoriaCredencialID: clean(row.CategoriaCredencialID, 220),
    Nombre: clean(row.Nombre, 250),
    Usuario: clean(row.Usuario, 500),
  });
  return {
    credentialId: id,
    password,
    revealedAt: nowIso(),
    expiresInSeconds: 30,
  };
}

export async function queryPasswordVaultForAssistant(ctx, {
  clientId,
  categoryId = '',
  search = '',
  limit = 30,
} = {}) {
  assertCanRead(ctx);
  await ensurePasswordVaultSchema();
  const tables = await readTables(['Clientes', 'CategoriasCredenciales', 'CredencialesClientes']);
  const clientsById = new Map(tables.Clientes.map((row) => [clean(row.ClienteID, 220), row]));
  const categoriesById = new Map(tables.CategoriasCredenciales.map((row) => [clean(row.CategoriaCredencialID, 220), row]));
  const searchKey = normalized(search);
  let rows = tables.CredencialesClientes.filter((row) => (
    active(row)
    && clean(row.ClienteID, 220) === clean(clientId, 220)
    && (!categoryId || clean(row.CategoriaCredencialID, 220) === clean(categoryId, 220))
  ));
  if (searchKey) {
    rows = rows.filter((row) => normalized([
      row.Nombre,
      row.Usuario,
      row.URL,
      row.Notas,
      categoriesById.get(clean(row.CategoriaCredencialID, 220))?.Nombre,
    ].join(' ')).includes(searchKey));
  }
  rows = rows
    .sort((left, right) => (
      clean(categoriesById.get(clean(left.CategoriaCredencialID, 220))?.Nombre).localeCompare(clean(categoriesById.get(clean(right.CategoriaCredencialID, 220))?.Nombre), 'es')
      || clean(left.Nombre).localeCompare(clean(right.Nombre), 'es')
    ))
    .slice(0, Math.min(50, Math.max(1, Number(limit || 30))));
  const result = rows.map((row) => ({
    ...credentialView(row, clientsById, categoriesById),
    password: decryptVaultSecret(row),
  }));
  await audit(ctx, 'CONSULTAR_CREDENCIALES_ASISTENTE', 'CredencialesClientes', clean(clientId, 220), null, {
    ClienteID: clean(clientId, 220),
    CategoriaCredencialID: clean(categoryId, 220),
    Filtro: clean(search, 300),
    Resultados: result.length,
  });
  return result;
}

add(['passwordVault.dashboard.get', 'credenciales.dashboard.get'], dashboard);
add(['passwordVault.categories.create', 'credenciales.categorias.create'], createCategory);
add(['passwordVault.categories.update', 'credenciales.categorias.update'], updateCategory);
add(['passwordVault.categories.delete', 'credenciales.categorias.delete'], deleteCategory);
add(['passwordVault.credentials.create', 'credenciales.create'], createCredential);
add(['passwordVault.credentials.update', 'credenciales.update'], updateCredential);
add(['passwordVault.credentials.delete', 'credenciales.delete'], deleteCredential);
add(['passwordVault.credentials.reveal', 'credenciales.reveal'], revealCredential);

export function isPasswordVaultRoute(route) {
  return ROUTES.has(String(route || ''));
}

export async function dispatchPasswordVaultAction({
  route,
  payload = {},
  sessionToken = '',
  ip = '',
  userAgent = '',
  origin = '',
}) {
  const handler = ROUTES.get(String(route || ''));
  if (!handler) {
    const error = new Error(`Ruta no encontrada: ${route}`);
    error.code = 'ROUTE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const auth = await authenticate(sessionToken);
  return handler({
    route,
    payload,
    sessionToken,
    ip,
    userAgent,
    origin,
    user: auth.user,
    permissions: auth.permissions,
  });
}

export const PASSWORD_VAULT_PERMISSIONS = Object.freeze({
  read: READ_PERMISSIONS,
  manage: 'USUARIOS_GESTIONAR',
});
