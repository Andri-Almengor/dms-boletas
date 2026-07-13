import { appendRow, filterRows, findById, readTable, updateRow } from '../infra/sheets.repository.js';
import { badRequest } from '../core/errors.js';
import { hashPassword, nowIso, pick, randomPassword, uuid } from '../core/utils.js';
import { safeUser } from '../services/permissions.service.js';
import { sendTemporaryCredentials } from '../services/email.service.js';
import { audit } from '../services/audit.service.js';

export const usersHandlers = {
  list: async ({ payload }) => filterRows((await readTable('Usuarios')).map(safeUser), payload, ['NombreCompleto','NombreUsuario','Correo']),
  assignable: async ({ payload }) => filterRows((await readTable('Usuarios')).filter((u) => String(u.Estado || '').toUpperCase() === 'ACTIVO').map(safeUser), payload, ['NombreCompleto','NombreUsuario','Correo']),
  get: async ({ payload }) => ({ user: safeUser(await findById('Usuarios', pick(payload,['usuarioId','UsuarioID','id']))) }),
  create: async (ctx) => {
    const p = ctx.payload; const email = String(p.correo || p.Correo || '').trim().toLowerCase(); const username = String(p.nombreUsuario || p.NombreUsuario || '').trim();
    if (!email || !username || !String(p.nombreCompleto || p.NombreCompleto || '').trim()) throw badRequest('Nombre, usuario y correo son obligatorios.');
    const existing = await readTable('Usuarios');
    if (existing.some((u) => String(u.Correo || '').trim().toLowerCase() === email || String(u.NombreUsuario || '').trim().toLowerCase() === username.toLowerCase())) throw badRequest('El correo o nombre de usuario ya existe.');
    const temporaryPassword = randomPassword(); const { salt, hash } = hashPassword(temporaryPassword);
    const row = { UsuarioID: uuid(), NombreCompleto: p.nombreCompleto || p.NombreCompleto, NombreUsuario: username, Correo: email, PasswordHash: hash, PasswordSalt: salt, CambioPasswordObligatorio: true, Estado: p.estado || p.Estado || 'ACTIVO', RolID: p.rolId || p.RolID, UltimoAcceso: '', IntentosFallidos: 0, BloqueadoHasta: '', CreadoPor: ctx.user.UsuarioID, FechaCreacion: nowIso(), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() };
    await appendRow('Usuarios', row); const invitationEmail = await sendTemporaryCredentials(row, temporaryPassword).catch((error) => ({ sent: false, error: error.message })); await audit(ctx,'CREAR_USUARIO','Usuarios',row.UsuarioID,null,safeUser(row));
    return { user: safeUser(row), temporaryPassword, invitationEmail };
  },
  update: async (ctx) => {
    const id = pick(ctx.payload,['usuarioId','UsuarioID','id']); const before = await findById('Usuarios', id);
    const patch = { NombreCompleto: pick(ctx.payload,['nombreCompleto','NombreCompleto'],before.NombreCompleto), NombreUsuario: pick(ctx.payload,['nombreUsuario','NombreUsuario'],before.NombreUsuario), Correo: pick(ctx.payload,['correo','Correo'],before.Correo), RolID: pick(ctx.payload,['rolId','RolID'],before.RolID), Estado: pick(ctx.payload,['estado','Estado'],before.Estado), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() };
    const after = await updateRow('Usuarios', id, patch); await audit(ctx,'EDITAR_USUARIO','Usuarios',id,safeUser(before),safeUser(after)); return { user: safeUser(after) };
  },
  roles: async () => ({ items: (await readTable('Roles')).filter((r) => String(r.Estado || '').toUpperCase() === 'ACTIVO') }),
};
