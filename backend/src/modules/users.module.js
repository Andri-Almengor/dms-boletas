import { appendRow, filterRows, findById, readTable, updateRow } from '../infra/sheets.repository.js';
import { badRequest } from '../core/errors.js';
import { asBool, hashPassword, nowIso, pick, randomPassword, uuid } from '../core/utils.js';
import { safeUser } from '../services/permissions.service.js';
import { sendTemporaryCredentialsWithAppsScript } from '../services/apps-script-user-invitation.service.js';
import { audit } from '../services/audit.service.js';

function normalizeUser(user) {
  const safe = safeUser(user);
  const displayName = String(pick(safe, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], '')).trim();
  const status = String(safe.Estado || '').trim();
  return {
    ...safe,
    NombreCompleto: String(pick(safe, ['NombreCompleto', 'Nombre'], displayName)).trim(),
    Nombre: String(pick(safe, ['Nombre', 'NombreCompleto'], displayName)).trim(),
    NombreUsuario: String(safe.NombreUsuario || '').trim(),
    Correo: String(safe.Correo || '').trim(),
    Estado: status,
    Activo: safe.Activo === undefined || safe.Activo === '' ? status.toUpperCase() === 'ACTIVO' : safe.Activo,
  };
}

async function revokeUserSessions(usuarioId) {
  const sessions = (await readTable('Sesiones')).filter((session) => (
    String(session.UsuarioID || '') === String(usuarioId || '')
    && !asBool(session.Revocada, false)
  ));
  const revokedAt = nowIso();
  for (const session of sessions) {
    await updateRow('Sesiones', session.SesionID, {
      Revocada: true,
      FechaRevocacion: revokedAt,
    });
  }
  return sessions.length;
}

export const usersHandlers = {
  list: async ({ payload }) => filterRows((await readTable('Usuarios')).map(normalizeUser), payload, ['NombreCompleto','Nombre','NombreUsuario','Correo']),
  assignable: async ({ payload = {} }) => {
    // Los formularios envían `activo: true` para todos los catálogos. Usuarios no
    // tiene columna Activo; utiliza Estado. Si se pasa ese filtro genérico, la
    // lista quedaba vacía aunque existieran técnicos activos.
    const { activo: _ignoredActiveFilter, ...filters } = payload;
    const users = (await readTable('Usuarios'))
      .filter((user) => String(user.Estado || '').trim().toUpperCase() === 'ACTIVO')
      .map(normalizeUser);
    return filterRows(users, filters, ['NombreCompleto','Nombre','NombreUsuario','Correo']);
  },
  get: async ({ payload }) => ({ user: normalizeUser(await findById('Usuarios', pick(payload,['usuarioId','UsuarioID','id']))) }),
  create: async (ctx) => {
    const p = ctx.payload; const email = String(p.correo || p.Correo || '').trim().toLowerCase(); const username = String(p.nombreUsuario || p.NombreUsuario || '').trim();
    if (!email || !username || !String(p.nombreCompleto || p.NombreCompleto || p.Nombre || '').trim()) throw badRequest('Nombre, usuario y correo son obligatorios.');
    const existing = await readTable('Usuarios');
    if (existing.some((u) => String(u.Correo || '').trim().toLowerCase() === email || String(u.NombreUsuario || '').trim().toLowerCase() === username.toLowerCase())) throw badRequest('El correo o nombre de usuario ya existe.');
    const temporaryPassword = randomPassword(); const { salt, hash } = hashPassword(temporaryPassword);
    const fullName = p.nombreCompleto || p.NombreCompleto || p.Nombre;
    const row = { UsuarioID: uuid(), NombreCompleto: fullName, Nombre: fullName, NombreUsuario: username, Correo: email, PasswordHash: hash, PasswordSalt: salt, CambioPasswordObligatorio: true, Estado: p.estado || p.Estado || 'ACTIVO', RolID: p.rolId || p.RolID, UltimoAcceso: '', IntentosFallidos: 0, BloqueadoHasta: '', CreadoPor: ctx.user.UsuarioID, FechaCreacion: nowIso(), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() };
    await appendRow('Usuarios', row); const invitationEmail = await sendTemporaryCredentialsWithAppsScript(row, temporaryPassword).catch((error) => ({ sent: false, error: error.message })); await audit(ctx,'CREAR_USUARIO','Usuarios',row.UsuarioID,null,normalizeUser(row));
    return { user: normalizeUser(row), temporaryPassword, invitationEmail };
  },
  update: async (ctx) => {
    const id = pick(ctx.payload,['usuarioId','UsuarioID','id']); const before = await findById('Usuarios', id);
    const fullName = pick(ctx.payload,['nombreCompleto','NombreCompleto','Nombre'],pick(before,['NombreCompleto','Nombre']));
    const patch = { NombreCompleto: fullName, Nombre: fullName, NombreUsuario: pick(ctx.payload,['nombreUsuario','NombreUsuario'],before.NombreUsuario), Correo: pick(ctx.payload,['correo','Correo'],before.Correo), RolID: pick(ctx.payload,['rolId','RolID'],before.RolID), Estado: pick(ctx.payload,['estado','Estado'],before.Estado), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() };
    const after = await updateRow('Usuarios', id, patch); await audit(ctx,'EDITAR_USUARIO','Usuarios',id,normalizeUser(before),normalizeUser(after)); return { user: normalizeUser(after) };
  },
  resetPassword: async (ctx) => {
    const id = pick(ctx.payload, ['usuarioId', 'UsuarioID', 'id']);
    const before = await findById('Usuarios', id);
    if (String(before.UsuarioID) === String(ctx.user.UsuarioID)) {
      throw badRequest('Para su propia cuenta utilice la opción Cambiar contraseña.');
    }
    if (String(before.Estado || '').trim().toUpperCase() !== 'ACTIVO') {
      throw badRequest('Debe activar el usuario antes de restablecer su contraseña.');
    }
    if (!String(before.Correo || '').trim()) {
      throw badRequest('El usuario no tiene un correo configurado para recibir la nueva contraseña.');
    }

    const temporaryPassword = randomPassword();
    const { salt, hash } = hashPassword(temporaryPassword);
    const resetAt = nowIso();
    const after = await updateRow('Usuarios', id, {
      PasswordHash: hash,
      PasswordSalt: salt,
      CambioPasswordObligatorio: true,
      IntentosFallidos: 0,
      BloqueadoHasta: '',
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: resetAt,
    });

    const revokedSessions = await revokeUserSessions(id);
    const resetKey = `password-reset:${id}:${Date.now()}:${uuid()}`;
    const email = await sendTemporaryCredentialsWithAppsScript(after, temporaryPassword, {
      credentialType: 'PASSWORD_RESET',
      idempotencyKey: resetKey,
    }).catch((error) => ({ sent: false, error: error.message }));

    await audit(ctx, 'RESTABLECER_PASSWORD_USUARIO', 'Usuarios', id, normalizeUser(before), {
      ...normalizeUser(after),
      CambioPasswordObligatorio: true,
      SesionesRevocadas: revokedSessions,
      CorreoEnviado: Boolean(email?.sent),
      ErrorCorreo: email?.error || '',
    });

    return {
      user: normalizeUser(after),
      email,
      revokedSessions,
      temporaryPassword: email?.sent ? '' : temporaryPassword,
      message: email?.sent
        ? `La contraseña fue restablecida y enviada a ${after.Correo}.`
        : 'La contraseña fue restablecida, pero el correo no pudo enviarse. Copie la contraseña temporal mostrada y entréguela al usuario de forma segura.',
    };
  },
  roles: async () => ({ items: (await readTable('Roles')).filter((r) => String(r.Estado || '').trim().toUpperCase() === 'ACTIVO') }),
};
