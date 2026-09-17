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

export async function findActiveSessionByTokenHash(tokenHash) {
  const hash = clean(tokenHash);
  if (!hash) return null;

  // Preserve the historical repository contract: Revocada=false is stored as
  // the text value "false" in canonical runtime columns.
  const result = await query(
    `SELECT ${selectList('Sesiones')}
       FROM "Sesiones"
      WHERE "__valid" = TRUE
        AND "TokenHash" = $1
        AND "Revocada" = $2
      ORDER BY "__db_id" ASC
      LIMIT 1`,
    [hash, 'false'],
    { label: 'auth.session.token' },
  );

  return result.rows[0] ? publicRow(result.rows[0]) : null;
}
