import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!testDatabaseUrl) {
  throw new Error('postgres-integration.mjs requires TEST_DATABASE_URL. Production DATABASE_URL is never accepted by this destructive test.');
}
process.env.NODE_ENV = 'test';

const {
  appendRow,
  findById,
  findRows,
  nextCustomerCaseNumber,
  queryCustomerCasePage,
  queryKnowledgeArticlePage,
  queryMaintenanceHomeSummary,
  queryPage,
  queryTicketPage,
  readTable,
  softDelete,
  updateRow,
} = await import('../src/infra/postgres.repository.js');
const { closePostgres, query, withTransaction } = await import('../src/infra/postgres.js');
const {
  appendSyncChanges,
  ensureSyncInfrastructure,
  getSyncCursor,
  getSyncDescriptor,
  readSyncChangesAfter,
} = await import('../src/services/sync-change.service.js');
const { createPortablePostgresBackupFile, cleanupPortableBackup } = await import('../src/services/postgres-backup.service.js');
const { reconcileCustomerCases } = await import('../src/services/customer-case-sync.service.js');
const { login, authenticate, logout } = await import('../src/services/auth.service.js');
const { hashPassword } = await import('../src/core/utils.js');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('repository CRUD and rollback stay transactional on PostgreSQL', async () => {
  const categoryId = `stage6-category-${suffix}`;
  const rollbackId = `stage6-rollback-${suffix}`;
  try {
    await appendRow('Categorias', {
      CategoriaID: categoryId,
      Nombre: 'Stage 6 CRUD',
      Descripcion: 'original',
      Estado: 'ACTIVO',
      Activo: true,
    });
    assert.equal((await findById('Categorias', categoryId)).Descripcion, 'original');
    assert.equal((await findRows('Categorias', { CategoriaID: categoryId }, { limit: 2 })).length, 1);

    const updated = await updateRow('Categorias', categoryId, { Descripcion: 'updated' });
    assert.equal(updated.Descripcion, 'updated');

    const deleted = await softDelete('Categorias', categoryId, 'STAGE6');
    assert.equal(String(deleted.Activo).toLowerCase(), 'false');
    assert.equal(deleted.Estado, 'INACTIVO');

    await assert.rejects(
      withTransaction(async () => {
        await appendRow('Categorias', {
          CategoriaID: rollbackId,
          Nombre: 'Rollback',
          Estado: 'ACTIVO',
          Activo: true,
        });
        throw new Error('stage6 rollback');
      }),
      /stage6 rollback/,
    );
    await assert.rejects(findById('Categorias', rollbackId), /No se encontró/);
  } finally {
    await query(
      'DELETE FROM "Categorias" WHERE "CategoriaID" = ANY($1::text[])',
      [[categoryId, rollbackId]],
      { label: 'test.stage6.crud.cleanup', write: true },
    ).catch(() => {});
  }
});

test('auth, sessions and permission overrides use direct PostgreSQL persistence', async () => {
  const roleId = `stage6-role-${suffix}`;
  const userId = `stage6-user-${suffix}`;
  const username = `stage6_${suffix}`;
  const permissionAllowId = `stage6-perm-allow-${suffix}`;
  const permissionDenyId = `stage6-perm-deny-${suffix}`;
  const roleLinkAllowId = `stage6-rolelink-allow-${suffix}`;
  const roleLinkDenyId = `stage6-rolelink-deny-${suffix}`;
  const userLinkDenyId = `stage6-userlink-deny-${suffix}`;
  const password = 'Stage6Pass123';
  const { salt, hash } = hashPassword(password);
  let token = '';

  try {
    await appendRow('Roles', {
      RolID: roleId,
      Nombre: 'Stage 6 role',
      EsAdministrador: false,
      Estado: 'ACTIVO',
    });
    await appendRow('Permisos', {
      PermisoID: permissionAllowId,
      Codigo: `STAGE6_ALLOW_${suffix}`,
      Modulo: 'TEST',
      Accion: 'ALLOW',
      Estado: 'ACTIVO',
    });
    await appendRow('Permisos', {
      PermisoID: permissionDenyId,
      Codigo: `STAGE6_DENY_${suffix}`,
      Modulo: 'TEST',
      Accion: 'DENY',
      Estado: 'ACTIVO',
    });
    await appendRow('RolPermisos', {
      RolPermisoID: roleLinkAllowId,
      RolID: roleId,
      PermisoID: permissionAllowId,
      Permitido: true,
    });
    await appendRow('RolPermisos', {
      RolPermisoID: roleLinkDenyId,
      RolID: roleId,
      PermisoID: permissionDenyId,
      Permitido: true,
    });
    await appendRow('UsuarioPermisos', {
      UsuarioPermisoID: userLinkDenyId,
      UsuarioID: userId,
      PermisoID: permissionDenyId,
      Permitido: false,
    });
    await appendRow('Usuarios', {
      UsuarioID: userId,
      NombreCompleto: 'Stage 6 User',
      NombreUsuario: username,
      Correo: `${username}@example.invalid`,
      PasswordHash: hash,
      PasswordSalt: salt,
      CambioPasswordObligatorio: false,
      Estado: 'ACTIVO',
      RolID: roleId,
      IntentosFallidos: 0,
      BloqueadoHasta: '',
    });

    const session = await login(username, password, { ip: '127.0.0.1', userAgent: 'stage6-ci' });
    token = session.sessionToken;
    assert.ok(token);
    assert.deepEqual(session.permissions, [`STAGE6_ALLOW_${suffix}`]);
    assert.equal(session.user.PasswordHash, undefined);
    assert.equal(session.user.PasswordSalt, undefined);

    const authenticated = await authenticate(token);
    assert.equal(authenticated.user.UsuarioID, userId);
    assert.deepEqual(authenticated.permissions, [`STAGE6_ALLOW_${suffix}`]);

    const storedSessions = await findRows('Sesiones', { UsuarioID: userId }, { limit: 10 });
    assert.equal(storedSessions.length, 1);
    assert.equal(String(storedSessions[0].Revocada).toLowerCase(), 'false');

    await logout(token);
    await assert.rejects(authenticate(token), (error) => Number(error?.status || error?.statusCode || 0) === 401);
  } finally {
    await query('DELETE FROM "Sesiones" WHERE "UsuarioID"=$1', [userId], { label: 'test.stage6.auth.sessions', write: true }).catch(() => {});
    await query('DELETE FROM "UsuarioPermisos" WHERE "UsuarioID"=$1', [userId], { label: 'test.stage6.auth.userPerms', write: true }).catch(() => {});
    await query('DELETE FROM "RolPermisos" WHERE "RolID"=$1', [roleId], { label: 'test.stage6.auth.rolePerms', write: true }).catch(() => {});
    await query('DELETE FROM "Usuarios" WHERE "UsuarioID"=$1', [userId], { label: 'test.stage6.auth.user', write: true }).catch(() => {});
    await query('DELETE FROM "Permisos" WHERE "PermisoID" = ANY($1::text[])', [[permissionAllowId, permissionDenyId]], { label: 'test.stage6.auth.perms', write: true }).catch(() => {});
    await query('DELETE FROM "Roles" WHERE "RolID"=$1', [roleId], { label: 'test.stage6.auth.role', write: true }).catch(() => {});
  }
});

test('SyncChanges rotates generation when schema version requires reconciliation', async () => {
  const forcedGeneration = `legacy-generation-${suffix}`;
  await query(
    "UPDATE sync_state SET generation=$1,schema_version=1,unsafe=FALSE,unsafe_reason='',updated_at=NOW() WHERE singleton=TRUE",
    [forcedGeneration],
    { label: 'test.stage6.sync.forceLegacy', write: true },
  );
  await ensureSyncInfrastructure();
  const descriptor = await getSyncDescriptor({ force: true });
  assert.equal(descriptor.schemaVersion, 2);
  assert.notEqual(descriptor.generation.split(':r')[0], forcedGeneration);
  const state = await query(
    'SELECT generation,schema_version FROM sync_state WHERE singleton=TRUE',
    [],
    { label: 'test.stage6.sync.state' },
  );
  assert.equal(Number(state.rows[0]?.schema_version), 2);
  assert.equal(String(state.rows[0]?.generation), descriptor.generation.split(':r')[0]);
});

test('critical PostgreSQL route queries return authoritative scoped data', async () => {
  const marker = `STAGE6_ROUTE_${suffix}`;
  const clientId = `stage6-client-${suffix}`;
  const maintenanceId = `stage6-maint-${suffix}`;
  const agendaId = `stage6-agenda-${suffix}`;
  const articleId = `stage6-article-${suffix}`;
  const caseId = `stage6-case-${suffix}`;
  const pendingId = `stage6-ticket-p-${suffix}`;
  const finishedId = `stage6-ticket-f-${suffix}`;
  const assignmentId = `stage6-assignment-${suffix}`;
  const evidenceId = `stage6-evidence-${suffix}`;

  try {
    await appendRow('Clientes', {
      ClienteID: clientId,
      Nombre: marker,
      Estado: 'ACTIVO',
      Activo: true,
    });
    await appendRow('Mantenimiento', {
      MantenimientoID: maintenanceId,
      TituloMantenimiento: marker,
      ClienteID: clientId,
      Cliente: marker,
      Estado: 'PENDIENTE',
      Fecha: '2026-09-17',
      Activo: true,
    });
    await appendRow('Agendas', {
      AgendaID: agendaId,
      Fecha: '2026-09-17',
      HoraInicio: '09:00',
      Detalle: marker,
      Estado: 'PENDIENTE',
      ClienteID: clientId,
      ClienteNombre: marker,
    });
    await appendRow('KnowledgeArticles', {
      TutorialID: articleId,
      Titulo: marker,
      ProblemaResuelto: 'Stage 6',
      Estado: 'PUBLICADO',
      Activo: true,
    });
    await appendRow('CasosClientes', {
      CasoID: caseId,
      CasoNumero: `TEST-${suffix}`,
      ClienteID: clientId,
      Cliente: marker,
      RazonVisita: marker,
      Problema: 'Stage 6',
      Estado: 'EN_ESPERA',
      FechaCreacion: '2026-09-17T10:00:00.000Z',
      Activo: true,
    });
    await appendRow('Boletas', {
      BoletaUID: pendingId,
      BoletaID: `PRUEBA-STAGE6-P-${suffix}`,
      EsPrueba: true,
      Titulo: marker,
      ClienteID: clientId,
      Cliente: marker,
      Estado: 'PENDIENTE',
      Fecha: '2026-09-17',
      Activo: true,
    });
    await appendRow('Boletas', {
      BoletaUID: finishedId,
      BoletaID: `PRUEBA-STAGE6-F-${suffix}`,
      EsPrueba: true,
      Titulo: marker,
      ClienteID: clientId,
      Cliente: marker,
      Estado: 'FINALIZADA',
      Fecha: '2026-09-17',
      Activo: true,
    });
    await appendRow('BoletaAsignados', {
      BoletaAsignadoID: assignmentId,
      BoletaUID: pendingId,
      UsuarioID: `stage6-tech-${suffix}`,
      Activo: true,
    });
    await appendRow('EvidenciasBoleta', {
      EvidenciaID: evidenceId,
      BoletaUID: pendingId,
      Nombre: marker,
      Orden: 1,
      Activo: true,
    });

    const home = await queryTicketPage({ page: 1, pageSize: 20, search: marker, homeSummary: true });
    assert.equal(home.homeSummary.pending, 1);
    assert.equal(home.homeSummary.finished, 1);

    const pending = await queryTicketPage({ page: 1, pageSize: 20, search: marker, estado: 'PENDIENTE' });
    assert.deepEqual(pending.items.map((row) => row.BoletaUID), [pendingId]);

    const finished = await queryTicketPage({ page: 1, pageSize: 20, search: marker, estado: 'FINALIZADA' });
    assert.deepEqual(finished.items.map((row) => row.BoletaUID), [finishedId]);

    assert.equal((await findById('Boletas', pendingId)).Titulo, marker);
    assert.equal((await findRows('BoletaAsignados', { BoletaUID: pendingId }, { limit: 20 })).length, 1);
    assert.equal((await findRows('EvidenciasBoleta', { BoletaUID: pendingId }, { limit: 20 })).length, 1);

    const maintenance = await queryPage('Mantenimiento', { page: 1, pageSize: 20, search: marker }, {
      searchFields: ['TituloMantenimiento', 'Cliente', 'Responsables', 'DescripcionGeneral', 'Ubicacion'],
      statusNormalized: true,
      excludeInactive: true,
    });
    assert.deepEqual(maintenance.items.map((row) => row.MantenimientoID), [maintenanceId]);
    const maintenanceSummary = await queryMaintenanceHomeSummary();
    assert.ok(maintenanceSummary.homeSummary.pending >= 1);

    const clients = await queryPage('Clientes', { page: 1, pageSize: 20, search: marker }, {
      searchFields: ['Nombre', 'RazonSocial', 'Identificacion', 'CorreoGeneral'],
      excludeInactive: true,
      excludeInactiveState: true,
    });
    assert.deepEqual(clients.items.map((row) => row.ClienteID), [clientId]);

    const agenda = await queryPage('Agendas', { page: 1, pageSize: 20, search: marker }, {
      searchFields: ['Detalle', 'ClienteNombre'],
      defaultOrder: [['Fecha', 'ASC'], ['HoraInicio', 'ASC']],
    });
    assert.deepEqual(agenda.items.map((row) => row.AgendaID), [agendaId]);

    const knowledge = await queryKnowledgeArticlePage({ page: 1, pageSize: 20, search: marker }, { canManage: true });
    assert.deepEqual(knowledge.items.map((row) => row.TutorialID), [articleId]);

    const cases = await queryCustomerCasePage({ page: 1, pageSize: 20, search: marker });
    assert.deepEqual(cases.items.map((row) => row.CasoID), [caseId]);
  } finally {
    await query('DELETE FROM "EvidenciasBoleta" WHERE "EvidenciaID"=$1', [evidenceId], { label: 'test.stage6.routes.evidence', write: true }).catch(() => {});
    await query('DELETE FROM "BoletaAsignados" WHERE "BoletaAsignadoID"=$1', [assignmentId], { label: 'test.stage6.routes.assignment', write: true }).catch(() => {});
    await query('DELETE FROM "Boletas" WHERE "BoletaUID" = ANY($1::text[])', [[pendingId, finishedId]], { label: 'test.stage6.routes.tickets', write: true }).catch(() => {});
    await query('DELETE FROM "CasosClientes" WHERE "CasoID"=$1', [caseId], { label: 'test.stage6.routes.case', write: true }).catch(() => {});
    await query('DELETE FROM "KnowledgeArticles" WHERE "TutorialID"=$1', [articleId], { label: 'test.stage6.routes.knowledge', write: true }).catch(() => {});
    await query('DELETE FROM "Agendas" WHERE "AgendaID"=$1', [agendaId], { label: 'test.stage6.routes.agenda', write: true }).catch(() => {});
    await query('DELETE FROM "Mantenimiento" WHERE "MantenimientoID"=$1', [maintenanceId], { label: 'test.stage6.routes.maintenance', write: true }).catch(() => {});
    await query('DELETE FROM "Clientes" WHERE "ClienteID"=$1', [clientId], { label: 'test.stage6.routes.client', write: true }).catch(() => {});
  }
});

test('duplicate-tolerant repository preserves Sheets first-read / last-update semantics', async () => {
  const key = `TEST_DUP_${suffix}`;
  await appendRow('Configuracion', { Clave: key, Valor: 'first' });
  await appendRow('Configuracion', { Clave: key, Valor: 'last' });
  assert.equal((await findById('Configuracion', key)).Valor, 'first');
  await updateRow('Configuracion', key, { Valor: 'updated-last' });
  const rows = (await readTable('Configuracion')).filter((row) => row.Clave === key);
  assert.deepEqual(rows.map((row) => row.Valor), ['first', 'updated-last']);
  await query('DELETE FROM "Configuracion" WHERE "Clave"=$1', [key], { label: 'test.cleanup', write: true });
});

test('ticket numbering is atomic in PostgreSQL and keeps full maintenance prefix', async () => {
  await query('DELETE FROM "Boletas" WHERE "BoletaUID" LIKE $1 OR "BoletaUID" LIKE $2', [`test-${suffix}-%`, `mnt-test-${suffix}%`], { label: 'test.cleanup', write: true });
  await query("DELETE FROM runtime_sequences WHERE entity IN ('BOLETA','MANTENIMIENTO_BOLETA')", [], { label: 'test.cleanup', write: true });
  await query(
    'INSERT INTO "Boletas" ("BoletaUID","BoletaID","Estado","__payload") VALUES ($1,$2,$3,$4::jsonb)',
    [`test-${suffix}-seed`, '499', 'PENDIENTE', JSON.stringify({ BoletaUID: `test-${suffix}-seed`, BoletaID: '499', Estado: 'PENDIENTE' })],
    { label: 'test.seed', write: true },
  );
  const first = { BoletaUID: `test-${suffix}-a`, BoletaID: 1, Titulo: 'A', ClienteID: 'x', Estado: 'PENDIENTE' };
  const second = { BoletaUID: `test-${suffix}-b`, BoletaID: 1, Titulo: 'B', ClienteID: 'x', Estado: 'PENDIENTE' };
  await Promise.all([appendRow('Boletas', first), appendRow('Boletas', second)]);
  assert.deepEqual(new Set([String(first.BoletaID), String(second.BoletaID)]), new Set(['500', '501']));

  await query(
    'INSERT INTO "Boletas" ("BoletaUID","BoletaID","Estado","__payload") VALUES ($1,$2,$3,$4::jsonb)',
    [`mnt-test-${suffix}-seed`, 'M205', 'PENDIENTE', JSON.stringify({ BoletaUID: `mnt-test-${suffix}-seed`, BoletaID: 'M205', Estado: 'PENDIENTE' })],
    { label: 'test.seed.maintenance', write: true },
  );
  const maintenance = { BoletaUID: `mnt-test-${suffix}`, BoletaID: 'M01', Titulo: 'M', ClienteID: 'x', Estado: 'PENDIENTE' };
  await appendRow('Boletas', maintenance);
  assert.equal(String(maintenance.BoletaID), 'M206');

  const testTicket = { BoletaUID: `test-${suffix}-custom`, BoletaID: `PRUEBA-${suffix}`, Titulo: 'Prueba', ClienteID: 'x', Estado: 'PENDIENTE', EsPrueba: true };
  await appendRow('Boletas', testTicket);
  assert.equal(testTicket.BoletaID, `PRUEBA-${suffix}`);
  await query('DELETE FROM "Boletas" WHERE "BoletaUID" LIKE $1 OR "BoletaUID" LIKE $2', [`test-${suffix}-%`, `mnt-test-${suffix}%`], { label: 'test.cleanup', write: true });
  await query("DELETE FROM runtime_sequences WHERE entity IN ('BOLETA','MANTENIMIENTO_BOLETA')", [], { label: 'test.cleanup', write: true });
});

test('customer case numbering is serialized through the same transaction as the insert', async () => {
  const ids = [`case-number-${suffix}-a`, `case-number-${suffix}-b`];
  const create = (caseId) => withTransaction(async () => {
    const caseNumber = await nextCustomerCaseNumber();
    await appendRow('CasosClientes', {
      CasoID: caseId,
      CasoNumero: caseNumber,
      Estado: 'EN_ESPERA',
      Activo: true,
      FechaCreacion: new Date().toISOString(),
    });
    return caseNumber;
  });

  try {
    const numbers = await Promise.all(ids.map(create));
    const numeric = numbers.map((value) => Number(String(value).replace(/\D/g, '')));
    assert.equal(new Set(numbers).size, 2);
    assert.equal(Math.abs(numeric[0] - numeric[1]), 1);
  } finally {
    await query(
      'DELETE FROM "CasosClientes" WHERE "CasoID" = ANY($1::text[])',
      [ids],
      { label: 'test.caseNumber.cleanup', write: true },
    ).catch(() => {});
  }
});

test('customer case reconciliation keeps both historical matching paths with bounded SQL candidates', async () => {
  const directCaseId = `reconcile-direct-${suffix}`;
  const originCaseId = `reconcile-origin-${suffix}`;
  const directTicketId = `reconcile-ticket-direct-${suffix}`;
  const originTicketId = `reconcile-ticket-origin-${suffix}`;
  const finalizedAt = '2026-09-17T18:00:00.000Z';

  try {
    await appendRow('CasosClientes', {
      CasoID: directCaseId,
      CasoNumero: `TEST-DIRECT-${suffix}`,
      Estado: 'EN_PROCESO',
      BoletaUID: directTicketId,
      Activo: true,
    });
    await appendRow('CasosClientes', {
      CasoID: originCaseId,
      CasoNumero: `TEST-ORIGIN-${suffix}`,
      Estado: 'EN_ESPERA',
      BoletaUID: '',
      BoletaID: '',
      Activo: true,
    });
    await appendRow('Boletas', {
      BoletaUID: directTicketId,
      BoletaID: `PRUEBA-RECON-DIRECT-${suffix}`,
      EsPrueba: true,
      Estado: 'FINALIZADA',
      FinalizadaEn: finalizedAt,
      Activo: true,
    });
    await appendRow('Boletas', {
      BoletaUID: originTicketId,
      BoletaID: `PRUEBA-RECON-ORIGIN-${suffix}`,
      EsPrueba: true,
      Estado: 'FINALIZADA',
      OrigenCasoID: originCaseId,
      FinalizadaEn: finalizedAt,
      Activo: true,
    });

    const updated = await reconcileCustomerCases('TEST');
    assert.equal(updated, 2);

    const direct = await findById('CasosClientes', directCaseId);
    assert.equal(direct.Estado, 'FINALIZADO');
    assert.equal(direct.FechaFinalizacion, finalizedAt);

    const origin = await findById('CasosClientes', originCaseId);
    assert.equal(origin.Estado, 'FINALIZADO');
    assert.equal(origin.BoletaUID, originTicketId);
    assert.equal(origin.BoletaID, `PRUEBA-RECON-ORIGIN-${suffix}`);
    assert.equal(origin.FechaFinalizacion, finalizedAt);
  } finally {
    await query(
      'DELETE FROM "Boletas" WHERE "BoletaUID" = ANY($1::text[])',
      [[directTicketId, originTicketId]],
      { label: 'test.caseReconcile.ticketCleanup', write: true },
    ).catch(() => {});
    await query(
      'DELETE FROM "CasosClientes" WHERE "CasoID" = ANY($1::text[])',
      [[directCaseId, originCaseId]],
      { label: 'test.caseReconcile.caseCleanup', write: true },
    ).catch(() => {});
  }
});

test('SyncChanges uses a monotonic database cursor', async () => {
  const before = await getSyncCursor();
  await appendSyncChanges([
    { resource: 'ticket', entityId: `sync-${suffix}-1`, operation: 'UPSERT', sourceRoute: 'test' },
    { resource: 'ticket', entityId: `sync-${suffix}-2`, operation: 'UPSERT', sourceRoute: 'test' },
  ]);
  const after = await getSyncCursor();
  assert.ok(after >= before + 2);
  const delta = await readSyncChangesAfter(before, { limit: 10 });
  assert.equal(delta.invalidCursor, false);
  assert.ok(delta.events.some((event) => event.EntityID === `sync-${suffix}-1`));
});



test('SyncChanges participates atomically in an ambient PostgreSQL transaction', async () => {
  const entityId = `sync-rollback-${suffix}`;
  const before = await getSyncCursor();
  await assert.rejects(
    withTransaction(async () => {
      await appendSyncChanges([
        { resource: 'ticket', entityId, operation: 'UPSERT', sourceRoute: 'test.rollback' },
      ]);
      throw new Error('force rollback');
    }),
    /force rollback/,
  );
  const after = await getSyncCursor();
  assert.equal(after, before);
  const persisted = await query(
    'SELECT COUNT(*)::int AS total FROM "SyncChanges" WHERE "__valid"=TRUE AND "EntityID"=$1',
    [entityId],
    { label: 'test.sync.rollback.verify' },
  );
  assert.equal(Number(persisted.rows[0]?.total || 0), 0);
});

test('ticket SQL paging preserves allowedIds authorization and home summary scope', async () => {
  const firstId = `authz-${suffix}-pending`;
  const secondId = `authz-${suffix}-finished`;
  try {
    await appendRow('Boletas', {
      BoletaUID: firstId,
      BoletaID: `PRUEBA-AUTHZ-${suffix}-1`,
      EsPrueba: true,
      Titulo: 'Visible',
      Estado: 'PENDIENTE',
      Activo: true,
      Fecha: '2026-09-17',
    });
    await appendRow('Boletas', {
      BoletaUID: secondId,
      BoletaID: `PRUEBA-AUTHZ-${suffix}-2`,
      EsPrueba: true,
      Titulo: 'Oculta',
      Estado: 'FINALIZADA',
      Activo: true,
      Fecha: '2026-09-17',
    });

    const visible = await queryTicketPage(
      { page: 1, pageSize: 20, homeSummary: true },
      { allowedIds: new Set([firstId]) },
    );
    assert.equal(visible.total, 1);
    assert.deepEqual(visible.items.map((row) => row.BoletaUID), [firstId]);
    assert.deepEqual(visible.homeSummary, { pending: 1, finished: 0 });

    const none = await queryTicketPage(
      { page: 1, pageSize: 20, homeSummary: true },
      { allowedIds: new Set() },
    );
    assert.deepEqual(none, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      homeSummary: { pending: 0, finished: 0 },
    });
  } finally {
    await query('DELETE FROM "Boletas" WHERE "BoletaUID" = ANY($1::text[])', [[firstId, secondId]], { label: 'test.authz.cleanup', write: true });
  }
});

test('portable PostgreSQL backup verifies and restores a controlled mutation', async () => {
  const key = `BACKUP_RESTORE_TEST_${suffix}`;
  const verifyScript = fileURLToPath(new URL('../src/scripts/db-backup-verify.js', import.meta.url));
  const restoreScript = fileURLToPath(new URL('../src/scripts/db-backup-restore.js', import.meta.url));
  let backup;
  try {
    await appendRow('Configuracion', { Clave: key, Valor: 'before-backup', Descripcion: 'integration restore test' });
    backup = await createPortablePostgresBackupFile();

    const verifyOutput = execFileSync(process.execPath, [verifyScript, '--file', backup.outputPath], {
      env: process.env,
      encoding: 'utf8',
    });
    assert.equal(JSON.parse(verifyOutput).ok, true);

    await updateRow('Configuracion', key, { Valor: 'after-backup' });
    assert.equal((await findById('Configuracion', key)).Valor, 'after-backup');

    const restoreOutput = execFileSync(process.execPath, [restoreScript, '--file', backup.outputPath, '--apply', '--replace'], {
      env: process.env,
      encoding: 'utf8',
    });
    const restored = JSON.parse(restoreOutput);
    assert.equal(restored.ok, true);
    assert.ok(restored.tables > 0);
    assert.ok(restored.rows >= 1);
    assert.equal((await findById('Configuracion', key)).Valor, 'before-backup');
  } finally {
    await query('DELETE FROM "Configuracion" WHERE "Clave"=$1', [key], { label: 'test.backup.cleanup', write: true }).catch(() => {});
    await cleanupPortableBackup(backup).catch(() => {});
  }
});

test.after(async () => { await closePostgres(); });
