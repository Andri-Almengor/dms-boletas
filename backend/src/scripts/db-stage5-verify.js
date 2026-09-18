import { scriptPool } from './db-script.js';

const pool = scriptPool();
const client = await pool.connect();
const checks = [];
const plans = [];

const requiredMigrations = [
  '009_stage5_access_media_indexes.sql',
  '010_stage5_auth_permission_indexes.sql',
];
const requiredIndexes = [
  'ix_boletaasignados_boletauid_usuarioid',
  'ix_evidenciasboleta_archivoid',
  'ix_boletas_firmaarchivoid',
  'ix_usuarios_login_nombreusuario_norm',
  'ix_usuarios_login_correo_norm',
  'ix_rolpermisos_rolid_permisoid',
  'ix_usuariopermisos_usuarioid_permisoid',
];

function walkPlan(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  output.push({
    nodeType: String(node['Node Type'] || ''),
    relation: String(node['Relation Name'] || ''),
    index: String(node['Index Name'] || ''),
    actualRows: Number(node['Actual Rows'] || 0),
  });
  for (const child of node.Plans || []) walkPlan(child, output);
  return output;
}

async function explain(name, sql, params = []) {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const root = result.rows[0]?.['QUERY PLAN']?.[0] || {};
  const nodes = walkPlan(root.Plan);
  plans.push({
    name,
    planningMs: Number(Number(root['Planning Time'] || 0).toFixed(3)),
    executionMs: Number(Number(root['Execution Time'] || 0).toFixed(3)),
    actualRows: Number(root.Plan?.['Actual Rows'] || 0),
    nodes: nodes.map((node) => ({
      nodeType: node.nodeType,
      relation: node.relation,
      index: node.index,
      actualRows: node.actualRows,
    })),
  });
}

async function scalar(sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

try {
  await client.query('BEGIN READ ONLY');

  const migrations = await client.query(
    'SELECT version FROM schema_migrations WHERE version = ANY($1::text[])',
    [requiredMigrations],
  );
  const applied = new Set(migrations.rows.map((row) => String(row.version)));
  const missingMigrations = requiredMigrations.filter((name) => !applied.has(name));
  checks.push({ name: 'stage5_migrations', ok: missingMigrations.length === 0, missing: missingMigrations });

  const indexes = await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1::text[])",
    [requiredIndexes],
  );
  const existingIndexes = new Set(indexes.rows.map((row) => String(row.indexname)));
  const missingIndexes = requiredIndexes.filter((name) => !existingIndexes.has(name));
  checks.push({ name: 'stage5_indexes', ok: missingIndexes.length === 0, missing: missingIndexes });

  const sync = await scalar(
    'SELECT generation,schema_version,unsafe FROM sync_state WHERE singleton=TRUE',
  );
  checks.push({
    name: 'sync_state',
    ok: Boolean(sync?.generation) && Number(sync?.schema_version || 0) >= 2,
    schemaVersion: Number(sync?.schema_version || 0),
    unsafe: Boolean(sync?.unsafe),
  });

  const connectionStats = await scalar(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE state='active')::int AS active FROM pg_stat_activity WHERE datname=current_database()",
  );

  const statusSql = `CASE
    WHEN UPPER(COALESCE("Estado",'')) LIKE '%FINAL%' THEN 'FINALIZADA'
    WHEN UPPER(COALESCE("Estado",'')) LIKE '%PEND%' THEN 'PENDIENTE'
    WHEN UPPER(COALESCE("Estado",'')) LIKE '%ANUL%' THEN 'ANULADA'
    ELSE UPPER(COALESCE("Estado",''))
  END`;

  await explain(
    'HOME',
    `SELECT
       COUNT(*) FILTER (WHERE ${statusSql}='PENDIENTE'),
       COUNT(*) FILTER (WHERE ${statusSql}='FINALIZADA')
     FROM "Boletas"
     WHERE "__valid"=TRUE AND ${statusSql}<>'ANULADA'`,
  );
  await explain(
    'PENDIENTES',
    `SELECT "__payload" FROM "Boletas"
     WHERE "__valid"=TRUE AND ${statusSql}='PENDIENTE'
     ORDER BY LEFT(COALESCE(NULLIF("Fecha",''),NULLIF("FechaCreacion",''),''),10) DESC,
              "__db_id" ASC
     LIMIT 100`,
  );
  await explain(
    'FINALIZADAS',
    `SELECT "__payload" FROM "Boletas"
     WHERE "__valid"=TRUE AND ${statusSql}='FINALIZADA'
     ORDER BY LEFT(COALESCE(NULLIF("Fecha",''),NULLIF("FechaCreacion",''),''),10) DESC,
              "__db_id" ASC
     LIMIT 100`,
  );

  const ticket = await scalar(
    'SELECT "BoletaUID" AS id FROM "Boletas" WHERE "__valid"=TRUE AND COALESCE("BoletaUID",\'\')<>\'\' ORDER BY "__db_id" DESC LIMIT 1',
  );
  if (ticket?.id) {
    await explain('DETALLE_BOLETA', 'SELECT "__payload" FROM "Boletas" WHERE "__valid"=TRUE AND "BoletaUID"=$1 LIMIT 1', [ticket.id]);
    await explain('DETALLE_ASIGNADOS', 'SELECT "__payload" FROM "BoletaAsignados" WHERE "__valid"=TRUE AND "BoletaUID"=$1 AND LOWER(COALESCE("Activo",\'true\'))<>\'false\'', [ticket.id]);
    await explain('DETALLE_EVIDENCIAS', 'SELECT "__payload" FROM "EvidenciasBoleta" WHERE "__valid"=TRUE AND "BoletaUID"=$1 AND LOWER(COALESCE("Activo",\'true\'))<>\'false\' ORDER BY "Orden"', [ticket.id]);
  }

  await explain('MANTENIMIENTOS', 'SELECT "__payload" FROM "Mantenimiento" WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",\'true\'))<>\'false\' ORDER BY "Fecha" DESC NULLS LAST LIMIT 100');
  await explain('CLIENTES', 'SELECT "__payload" FROM "Clientes" WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",\'true\'))<>\'false\' ORDER BY "Nombre" ASC NULLS LAST LIMIT 100');
  await explain('AGENDA', 'SELECT "__payload" FROM "Agendas" WHERE "__valid"=TRUE ORDER BY "Fecha" ASC NULLS LAST LIMIT 100');
  await explain('KNOWLEDGE', 'SELECT "__payload" FROM "KnowledgeArticles" WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",\'true\'))<>\'false\' AND UPPER(COALESCE(NULLIF("Estado",\'\'),\'PUBLICADO\'))=\'PUBLICADO\' ORDER BY "__db_id" ASC LIMIT 60');
  await explain('CASES', 'SELECT "__payload" FROM "CasosClientes" WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",\'true\'))<>\'false\' ORDER BY "FechaCreacion" DESC NULLS LAST LIMIT 60');

  const login = await scalar(
    'SELECT LOWER(BTRIM(COALESCE("NombreUsuario",\'\'))) AS value FROM "Usuarios" WHERE "__valid"=TRUE AND COALESCE("NombreUsuario",\'\')<>\'\' ORDER BY "__db_id" ASC LIMIT 1',
  );
  if (login?.value) {
    await explain(
      'AUTH_LOGIN',
      'SELECT "__db_id" FROM "Usuarios" WHERE "__valid"=TRUE AND (LOWER(BTRIM(COALESCE("NombreUsuario",\'\')))=$1 OR LOWER(BTRIM(COALESCE("Correo",\'\')))=$1) ORDER BY "__db_id" ASC LIMIT 1',
      [login.value],
    );
  }

  const session = await scalar(
    'SELECT "TokenHash" AS value FROM "Sesiones" WHERE "__valid"=TRUE AND COALESCE("TokenHash",\'\')<>\'\' ORDER BY "__db_id" DESC LIMIT 1',
  );
  if (session?.value) {
    await explain(
      'AUTH_SESSION',
      'SELECT "__db_id" FROM "Sesiones" WHERE "__valid"=TRUE AND "TokenHash"=$1 AND LOWER(BTRIM(COALESCE("Revocada",\'\'))) NOT IN (\'true\',\'1\',\'si\',\'sí\',\'yes\',\'activo\') ORDER BY "__db_id" ASC LIMIT 1',
      [session.value],
    );
  }

  const role = await scalar(
    'SELECT "RolID" AS role_id FROM "Usuarios" WHERE "__valid"=TRUE AND COALESCE("RolID",\'\')<>\'\' ORDER BY "__db_id" ASC LIMIT 1',
  );
  if (role?.role_id) {
    await explain('AUTH_ROLE_PERMISSIONS', 'SELECT "__payload" FROM "RolPermisos" WHERE "__valid"=TRUE AND "RolID"=$1 ORDER BY "__db_id" ASC', [role.role_id]);
  }

  const user = await scalar(
    'SELECT "UsuarioID" AS user_id FROM "Usuarios" WHERE "__valid"=TRUE AND COALESCE("UsuarioID",\'\')<>\'\' ORDER BY "__db_id" ASC LIMIT 1',
  );
  if (user?.user_id) {
    await explain('AUTH_USER_PERMISSIONS', 'SELECT "__payload" FROM "UsuarioPermisos" WHERE "__valid"=TRUE AND "UsuarioID"=$1 ORDER BY "__db_id" ASC', [user.user_id]);
  }

  const cursor = await scalar('SELECT COALESCE(MAX(cursor),0)::bigint AS value FROM "SyncChanges" WHERE "__valid"=TRUE');
  const fromCursor = Math.max(0, Number(cursor?.value || 0) - 250);
  await explain('SYNC_DELTA', 'SELECT cursor FROM "SyncChanges" WHERE "__valid"=TRUE AND cursor>$1 ORDER BY cursor ASC LIMIT 250', [fromCursor]);

  await client.query('COMMIT');

  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    readOnly: true,
    connections: {
      total: Number(connectionStats?.total || 0),
      active: Number(connectionStats?.active || 0),
      configuredPoolMax: Number(process.env.PG_POOL_MAX || 3),
    },
    checks,
    plans,
  }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
