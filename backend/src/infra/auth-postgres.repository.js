import { query } from './postgres.js';
import {
  _publicRow as publicRow,
  _selectList as selectList,
} from './postgres.repository.core.js';

function clean(value) {
  return String(value ?? '').trim();
}

export async function findUserByLogin(login) {
  const key = clean(login).toLowerCase();
  if (!key) return null;

  const result = await query(
    `SELECT ${selectList('Usuarios')}
       FROM "Usuarios"
      WHERE "__valid" = TRUE
        AND (
          LOWER(BTRIM(COALESCE("NombreUsuario", ''))) = $1
          OR LOWER(BTRIM(COALESCE("Correo", ''))) = $1
        )
      ORDER BY "__db_id" ASC
      LIMIT 1`,
    [key],
    { label: 'auth.user.login' },
  );

  return result.rows[0] ? publicRow(result.rows[0]) : null;
}

export async function findUserById(userId) {
  const id = clean(userId);
  if (!id) return null;

  const result = await query(
    `SELECT ${selectList('Usuarios')}
       FROM "Usuarios"
      WHERE "__valid" = TRUE
        AND "UsuarioID" = $1
      ORDER BY "__db_id" ASC
      LIMIT 1`,
    [id],
    { label: 'auth.user.id' },
  );

  return result.rows[0] ? publicRow(result.rows[0]) : null;
}

export async function findActiveSessionByTokenHash(tokenHash) {
  const hash = clean(tokenHash);
  if (!hash) return null;

  // Preserve asBool(value, false) semantics from the Sheets runtime:
  // only historical truthy spellings mean revoked; empty/false/unknown stay active.
  const result = await query(
    `SELECT ${selectList('Sesiones')}
       FROM "Sesiones"
      WHERE "__valid" = TRUE
        AND "TokenHash" = $1
        AND LOWER(BTRIM(COALESCE("Revocada", ''))) NOT IN ('true','1','si','sí','yes','activo')
      ORDER BY "__db_id" ASC
      LIMIT 1`,
    [hash],
    { label: 'auth.session.token' },
  );

  return result.rows[0] ? publicRow(result.rows[0]) : null;
}
