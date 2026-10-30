import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!testDatabaseUrl) {
  throw new Error('postgres-integration.mjs requires TEST_DATABASE_URL. Production DATABASE_URL is never accepted by this destructive test.');
}
process.env.NODE_ENV = 'test';
// Test-only write permission: this suite uses a disposable TEST_DATABASE_URL.
process.env.AI_WRITE_ENABLED = 'true';

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
const {
  getKnowledgeDocument,
  searchKnowledgeDocuments,
  searchKnowledgeDocumentChunks,
} = await import('../src/ai/agent.repository.knowledge-documents.js');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('maintenance progress ignores an old queued snapshot once the same maintenance is finalized', async () => {
  const { notifyMaintenanceProgress } = await import('../src/services/maintenance-progress-chat.service.js');
  const maintenanceId = 'stage6-progress-close-race-' + suffix;
  const historical = {
    MantenimientoID: maintenanceId,
    TituloMantenimiento: 'Proyecto Zeus',
    Cliente: 'Digital Management Systems, S.A.',
    Ubicacion: 'Oficinas Sabana',
    Estado: 'PENDIENTE',
    Activo: true,
  };
  try {
    await appendRow('Mantenimiento', historical);
    await updateRow('Mantenimiento', maintenanceId, {
      Cliente: 'Cliente corregido',
      Ubicacion: 'Sede corregida',
      Estado: 'FINALIZADO',
      EstadoFinalizacion: 'COMPLETADO',
      FechaActualizacion: '2026-10-26T22:00:00.000Z',
    });

    const stored = (await findRows('Mantenimiento', { MantenimientoID: maintenanceId }, { limit: 2 }));
    assert.equal(stored.length, 1, 'El esquema único de mantenimiento permite un solo ID vigente');
    assert.equal(stored[0].Estado, 'FINALIZADO');
    assert.equal(stored[0].Cliente, 'Cliente corregido');

    // Simula un worker que encoló un objeto anterior a la finalización.
    // No debe preparar webhook ni registrar un envío para este slot.
    const result = await notifyMaintenanceProgress({
      maintenance: historical,
      reason: 'SCHEDULED',
      slot: '17:00',
      slotKey: '2026-10-26|17:00',
      now: new Date('2026-10-26T23:00:00.000Z'),
    });
    assert.equal(result.sent, false);
    assert.equal(result.skipped, 'NOT_PENDING');
    assert.equal((await findRows('Notificaciones', { EntidadID: maintenanceId }, { limit: 10 })).length, 0);
  } finally {
    await query('DELETE FROM "Mantenimiento" WHERE "MantenimientoID"=$1', [maintenanceId], {
      label: 'test.progress.closeRaceCleanup', write: true,
    }).catch(() => {});
  }
});

test('moving a maintenance between clients preserves device identity and requires valid destination locations', async () => {
  const { maintenanceLocationGroupHandlers } = await import('../src/modules/maintenance-location-groups.module.js');
  const ids = {
    oldClient: 'stage6-old-client-' + suffix,
    newClient: 'stage6-new-client-' + suffix,
    oldLocation: 'stage6-old-location-' + suffix,
    newLocation: 'stage6-new-location-' + suffix,
    oldEquipment: 'stage6-old-equipment-' + suffix,
    newEquipment: 'stage6-new-equipment-' + suffix,
    maintenance: 'stage6-transfer-maintenance-' + suffix,
    device: 'stage6-transfer-device-' + suffix,
    image: 'stage6-transfer-image-' + suffix,
  };
  const admin = { user: { UsuarioID: 'stage6-admin' }, permissions: ['USUARIOS_GESTIONAR'] };
  const payloadFor = (data) => ({ ...admin, payload: { maintenanceId: ids.maintenance, ...data } });

  try {
    await appendRow('Clientes', { ClienteID: ids.oldClient, Nombre: 'Cliente anterior', Activo: true });
    await appendRow('Clientes', { ClienteID: ids.newClient, Nombre: 'Cliente correcto', Activo: true });
    await appendRow('ClienteUbicaciones', { UbicacionID: ids.oldLocation, ClienteID: ids.oldClient, Nombre: 'Sede anterior', Activo: true });
    await appendRow('ClienteUbicaciones', { UbicacionID: ids.newLocation, ClienteID: ids.newClient, Nombre: 'Sede correcta', Activo: true });
    await appendRow('ClienteUbicacionesEquipo', { UbicacionEquipoID: ids.oldEquipment, UbicacionID: ids.oldLocation, Nombre: 'Rack anterior', Activo: true });
    await appendRow('ClienteUbicacionesEquipo', { UbicacionEquipoID: ids.newEquipment, UbicacionID: ids.newLocation, Nombre: 'Rack correcto', Activo: true });
    await appendRow('Mantenimiento', {
      MantenimientoID: ids.maintenance, ClienteID: ids.oldClient, UbicacionID: ids.oldLocation,
      Estado: 'PENDIENTE', Activo: true,
      UbicacionesEquipoJSON: JSON.stringify([{ id: ids.oldEquipment, name: 'Rack anterior', locationId: ids.oldLocation }]),
    });
    await appendRow('Evidencia_Mantenimientos', {
      EvidenciaMantenimientoID: ids.device, MantenimientoRef: ids.maintenance,
      UbicacionEquipoID: ids.oldEquipment, Categoria: 'Cámara', TipoDispositivo: 'Cámara',
      NombreDispositivo: 'Cámara 01', Zona: 'Rack anterior', Activo: true,
    });
    await appendRow('Mantenimiento imagenes', {
      FotoDispositivoID: ids.image, DispositivoMantenimientoRef: ids.device,
      Tipo: 'Antes', Nota: 'Evidencia que debe conservarse', Activo: true,
    });
    // The main location cannot silently continue pointing at the wrong client.
    await assert.rejects(
      maintenanceLocationGroupHandlers.update(payloadFor({
        ClienteID: ids.newClient, Cliente: 'Cliente correcto',
        UbicacionID: ids.oldLocation, Ubicacion: 'Sede anterior',
      })),
      /no pertenece al nuevo cliente/,
    );
    await maintenanceLocationGroupHandlers.update(payloadFor({
      ClienteID: ids.newClient, Cliente: 'Cliente correcto',
      UbicacionID: ids.newLocation, Ubicacion: 'Sede correcta',
    }));

    const before = await maintenanceLocationGroupHandlers.get(payloadFor({}));
    const historical = before.ubicacionesEquipo.find((item) => item.id === ids.oldEquipment);
    assert.equal(historical?.foreignClient, true);
    assert.equal(historical?.available, false);
    assert.equal(historical?.deviceCount, 1);

    const expanded = await maintenanceLocationGroupHandlers.locationsUpdate(
      payloadFor({ ubicacionesEquipoIds: [ids.oldEquipment, ids.newEquipment] }),
    );
    assert.equal(expanded.ubicacionesEquipo.some((item) => item.id === ids.newEquipment && item.available), true);

    await assert.rejects(
      maintenanceLocationGroupHandlers.locationsUpdate(
        payloadFor({ ubicacionesEquipoIds: [ids.oldEquipment, ids.newEquipment, 'missing-equipment'] }),
      ),
      /ya no existe/,
    );

    const moved = await maintenanceLocationGroupHandlers.deviceUpdate(payloadFor({
      deviceId: ids.device, UbicacionEquipoID: ids.newEquipment, Zona: 'Rack correcto',
    }));
    assert.equal(moved.UbicacionEquipoID, ids.newEquipment);
    const persisted = await findById('Evidencia_Mantenimientos', ids.device);
    assert.equal(persisted.UbicacionEquipoID, ids.newEquipment);
    assert.equal(persisted.EvidenciaMantenimientoID, ids.device);
    const evidence = await findById('Mantenimiento imagenes', ids.image);
    assert.equal(evidence.DispositivoMantenimientoRef, ids.device);
    assert.equal(evidence.Nota, 'Evidencia que debe conservarse');

    await assert.rejects(
      maintenanceLocationGroupHandlers.deviceUpdate(payloadFor({
        deviceId: ids.device, UbicacionEquipoID: ids.oldEquipment, Zona: 'Rack anterior',
      })),
      /pertenece a otro cliente/,
    );
    assert.equal((await findById('Evidencia_Mantenimientos', ids.device)).UbicacionEquipoID, ids.newEquipment);
    await assert.rejects(
      maintenanceLocationGroupHandlers.deviceUpdate(payloadFor({
        maintenanceId: 'unrelated-maintenance', deviceId: ids.device,
        UbicacionEquipoID: ids.oldEquipment,
      })),
      /no pertenece al mantenimiento indicado/,
    );
    assert.equal((await findById('Evidencia_Mantenimientos', ids.device)).UbicacionEquipoID, ids.newEquipment);

    const cleaned = await maintenanceLocationGroupHandlers.locationsUpdate(
      payloadFor({ ubicacionesEquipoIds: [ids.newEquipment] }),
    );
    assert.equal(cleaned.ubicacionesEquipo.some((item) => item.id === ids.oldEquipment), false);
    assert.equal(cleaned.ubicacionesEquipo.some((item) => item.id === ids.newEquipment), true);
  } finally {
    await query('DELETE FROM "Mantenimiento imagenes" WHERE "DispositivoMantenimientoRef"=$1', [ids.device], { label: 'stage6.transfer.clean.images', write: true }).catch(() => {});
    await query('DELETE FROM "Evidencia_Mantenimientos" WHERE "EvidenciaMantenimientoID"=$1', [ids.device], { label: 'stage6.transfer.clean.device', write: true }).catch(() => {});
    await query('DELETE FROM "Mantenimiento" WHERE "MantenimientoID"=$1', [ids.maintenance], { label: 'stage6.transfer.clean.maintenance', write: true }).catch(() => {});
    await query('DELETE FROM "ClienteUbicacionesEquipo" WHERE "UbicacionEquipoID"=ANY($1::text[])', [[ids.oldEquipment, ids.newEquipment]], { label: 'stage6.transfer.clean.equipment', write: true }).catch(() => {});
    await query('DELETE FROM "ClienteUbicaciones" WHERE "UbicacionID"=ANY($1::text[])', [[ids.oldLocation, ids.newLocation]], { label: 'stage6.transfer.clean.locations', write: true }).catch(() => {});
    await query('DELETE FROM "Clientes" WHERE "ClienteID"=ANY($1::text[])', [[ids.oldClient, ids.newClient]], { label: 'stage6.transfer.clean.clients', write: true }).catch(() => {});
  }
});


const { ensureColumns, getHeaders } = await import('../src/infra/postgres.repository.js');
const { maintenanceFinalizationControlHandlers } = await import('../src/services/maintenance-finalization-control.service.js');
const { createFinalizationJob, getFinalizationJob } = await import('../src/services/maintenance-finalization-job.storage.js');

test('maintenance finalization schema matches PostgreSQL, preserves progress and supports authorized stop', async () => {
  const required = [
    'EstadoFinalizacion', 'PasoFinalizacion', 'FinalizacionSolicitudID',
    'FinalizacionIntentos', 'FinalizacionSolicitadaEn', 'FinalizacionIniciadaEn',
    'FinalizacionActualizadaEn', 'FinalizacionCompletadaEn', 'FinalizacionSolicitadaPor',
    'UltimoErrorFinalizacion', 'FinalizacionJobID', 'FinalizacionProgreso',
    'FinalizacionTotalBoletas', 'FinalizacionBoletasCompletadas',
    'FinalizacionTotalDispositivos', 'FinalizacionDispositivosCompletados',
    'FinalizacionTotalEvidencias', 'FinalizacionEvidenciasProcesadas',
    'FinalizacionMensaje', 'FirmaEstadoFinalizacion', 'FirmaOmitidaAlFinalizar',
    'FinalizacionProgramadaPara', 'FinalizacionProgramadaEn', 'FinalizacionCanceladaEn',
    'BoletasGeneradasJSON', 'BoletasGeneradasCantidad', 'BoletasGeneradasEn',
    'EstadoBoletasMantenimiento', 'UltimoErrorBoletasMantenimiento',
  ];
  const headers = await getHeaders('Mantenimiento');
  assert.deepEqual(required.filter((column) => !headers.includes(column)), [], 'runtime catalog missing finalization columns');
  await assert.doesNotReject(ensureColumns('Mantenimiento', required));
  const physical = await query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',
    ['Mantenimiento'],
    { label: 'test.maintenance.finalization.schema' },
  );
  const actual = new Set(physical.rows.map((row) => row.column_name));
  assert.deepEqual(required.filter((column) => !actual.has(column)), [], 'migration missing physical finalization columns');

  const scheduledId = `stage6-finalize-scheduled-${suffix}`;
  const runningId = `stage6-finalize-running-${suffix}`;
  let jobId = '';
  const admin = { user: { UsuarioID: 'stage6-admin' }, permissions: ['USUARIOS_GESTIONAR'] };
  try {
    await appendRow('Mantenimiento', {
      MantenimientoID: scheduledId,
      Estado: 'PENDIENTE',
      EstadoFinalizacion: 'PROGRAMADO',
      FinalizacionProgramadaPara: '2026-10-09T23:00:00.000Z',
      FinalizacionIntentos: '0',
      Activo: true,
    });
    await assert.rejects(
      maintenanceFinalizationControlHandlers.stop({
        ...admin,
        permissions: ['MANTENIMIENTOS_VER'],
        payload: { maintenanceId: scheduledId },
      }),
      (error) => Number(error.status) === 403,
    );
    const stoppedSchedule = await maintenanceFinalizationControlHandlers.stop({
      ...admin, payload: { maintenanceId: scheduledId },
    });
    assert.equal(stoppedSchedule.stopped, true);
    const scheduleRow = await findById('Mantenimiento', scheduledId);
    assert.equal(scheduleRow.EstadoFinalizacion, 'DETENIDO');
    assert.equal(scheduleRow.FinalizacionProgramadaPara, '');

    await appendRow('Mantenimiento', {
      MantenimientoID: runningId,
      Estado: 'PENDIENTE',
      EstadoFinalizacion: 'EN_PROCESO',
      Activo: true,
    });
    const job = await createFinalizationJob({ maintenanceId: runningId, actor: 'stage6-admin' });
    jobId = job.JobID;
    await updateRow('Mantenimiento', runningId, {
      FinalizacionJobID: jobId,
      FinalizacionIntentos: 1,
      FinalizacionTotalDispositivos: 54,
      FinalizacionDispositivosCompletados: 12,
    });
    const persisted = await findById('Mantenimiento', runningId);
    assert.equal(String(persisted.FinalizacionJobID), jobId);
    assert.equal(Number(persisted.FinalizacionTotalDispositivos), 54);
    assert.equal(Number(persisted.FinalizacionDispositivosCompletados), 12);
    const stoppedRunning = await maintenanceFinalizationControlHandlers.stop({
      ...admin, payload: { maintenanceId: runningId },
    });
    assert.equal(stoppedRunning.stopped, true);
    assert.equal((await getFinalizationJob(jobId)).Estado, 'DETENIDO');
    const runningRow = await findById('Mantenimiento', runningId);
    assert.equal(runningRow.EstadoFinalizacion, 'DETENIDO');
    assert.equal(Number(runningRow.FinalizacionDispositivosCompletados), 12, 'stop must preserve completed work');
  } finally {
    if (jobId) {
      await query('DELETE FROM "MaintenanceFinalizationItems" WHERE "JobID"=$1', [jobId], { label: 'test.finalization.cleanup.items', write: true }).catch(() => {});
      await query('DELETE FROM "MaintenanceFinalizationJobs" WHERE "JobID"=$1', [jobId], { label: 'test.finalization.cleanup.job', write: true }).catch(() => {});
    }
    await query('DELETE FROM "Mantenimiento" WHERE "MantenimientoID"=ANY($1::text[])',
      [[scheduledId, runningId]], { label: 'test.finalization.cleanup.maintenance', write: true }).catch(() => {});
  }
});

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

test('Knowledge document repositories enforce parent article visibility in PostgreSQL', async () => {
  const marker = `AXISKNOWLEDGE${Date.now()}${Math.random().toString(16).slice(2)}`;
  const readerId = `stage6-knowledge-reader-${suffix}`;
  const otherId = `stage6-knowledge-other-${suffix}`;
  const publicArticle = `stage6-knowledge-public-${suffix}`;
  const ownDraft = `stage6-knowledge-own-${suffix}`;
  const foreignDraft = `stage6-knowledge-foreign-${suffix}`;
  const publicDocument = `stage6-document-public-${suffix}`;
  const ownDocument = `stage6-document-own-${suffix}`;
  const foreignDocument = `stage6-document-foreign-${suffix}`;
  const now = new Date().toISOString();
  const ctx = { user: { UsuarioID: readerId }, permissions: ['BOLETAS_VER'], sessionToken: 'stage6-session' };

  try {
    for (const row of [
      { TutorialID: publicArticle, Titulo: `${marker} Axis C1410 + C8110`, Estado: 'PUBLICADO', AutorUsuarioID: otherId },
      { TutorialID: ownDraft, Titulo: `${marker} Draft propio`, Estado: 'BORRADOR', AutorUsuarioID: readerId },
      { TutorialID: foreignDraft, Titulo: `${marker} Draft ajeno`, Estado: 'BORRADOR', AutorUsuarioID: otherId },
    ]) {
      await appendRow('KnowledgeArticles', { ...row, ProblemaResuelto: '', ContenidoHTML: '', Activo: true, FechaCreacion: now, FechaActualizacion: now });
    }

    for (const row of [
      { AdjuntoID: publicDocument, TutorialID: publicArticle, Nombre: `Guia Axis C1410 + C8110 ${marker}.pdf` },
      { AdjuntoID: ownDocument, TutorialID: ownDraft, Nombre: `Manual propio ${marker}.pdf` },
      { AdjuntoID: foreignDocument, TutorialID: foreignDraft, Nombre: `Manual ajeno ${marker}.pdf` },
    ]) {
      await appendRow('KnowledgeAttachments', {
        ...row,
        MimeType: 'application/pdf',
        Size: '100',
        SizeBytes: 100,
        DriveFileID: '',
        DriveURL: '',
        IsPrimary: true,
        ExtractionStatus: 'INDEXED',
        ExtractionError: '',
        IndexedAt: now,
        SearchText: `${marker} Axis C1410 C8110 network audio bridge speaker PoE`,
        Status: 'READY',
        Activo: true,
        CreadoPor: readerId,
        FechaCreacion: now,
        ActualizadoPor: readerId,
        FechaActualizacion: now,
      });
    }

    for (const [chunkId, documentId, articleId, text] of [
      [`chunk-public-${suffix}`, publicDocument, publicArticle, `${marker} PoE integración de audio C8110 C1410`],
      [`chunk-own-${suffix}`, ownDocument, ownDraft, `${marker} draft propio autorizado`],
      [`chunk-foreign-${suffix}`, foreignDocument, foreignDraft, `${marker} draft ajeno privado`],
    ]) {
      await query(
        `INSERT INTO "KnowledgeDocumentChunks"
          ("ChunkID","DocumentID","ArticleID","ChunkIndex","PageNumber","SectionTitle","Content","SearchText","CreatedAt","__valid")
         VALUES ($1,$2,$3,0,NULL,'Audio',$4,$4,$5,TRUE)`,
        [chunkId, documentId, articleId, text, now],
        { label: 'test.stage6.knowledge.chunk', write: true },
      );
    }

    const visible = await searchKnowledgeDocuments(ctx, { query: `${marker} Axis C1410 C8110`, limit: 10 });
    const visibleIds = new Set(visible.modelData.items.map((item) => item.id));
    assert.equal(visibleIds.has(publicDocument), true);
    assert.equal(visibleIds.has(ownDocument), true);
    assert.equal(visibleIds.has(foreignDocument), false);

    const own = await searchKnowledgeDocuments(ctx, { articleId: ownDraft, limit: 10 });
    assert.equal(own.modelData.items.some((item) => item.id === ownDocument), true);

    const hidden = await searchKnowledgeDocuments(ctx, { articleId: foreignDraft, limit: 10 });
    assert.equal(hidden.modelData.totalShown, 0);
    await assert.rejects(getKnowledgeDocument(ctx, { documentId: foreignDocument }), /no puede consultar/i);
    await assert.rejects(
      searchKnowledgeDocumentChunks(ctx, { documentId: foreignDocument, query: marker }),
      /no puede consultar/i,
    );

    const chunks = await searchKnowledgeDocumentChunks(ctx, { documentId: publicDocument, query: `PoE ${marker}`, limit: 10 });
    assert.equal(chunks.modelData.totalShown, 1);
    assert.equal(chunks.modelData.items[0].documentId, publicDocument);
    assert.equal(chunks.modelData.items[0].pageNumber, null);

    const admin = await searchKnowledgeDocuments(
      { user: { UsuarioID: 'ADMIN-STAGE6' }, permissions: ['CONOCIMIENTO_GESTIONAR'], sessionToken: 'stage6-admin-session' },
      { articleId: foreignDraft, limit: 10 },
    );
    assert.equal(admin.modelData.items.some((item) => item.id === foreignDocument), true);
  } finally {
    await query('DELETE FROM "KnowledgeDocumentChunks" WHERE "ArticleID" = ANY($1::text[])', [[publicArticle, ownDraft, foreignDraft]], { label: 'test.stage6.knowledge.chunks.cleanup', write: true }).catch(() => {});
    await query('DELETE FROM "KnowledgeAttachments" WHERE "TutorialID" = ANY($1::text[])', [[publicArticle, ownDraft, foreignDraft]], { label: 'test.stage6.knowledge.documents.cleanup', write: true }).catch(() => {});
    await query('DELETE FROM "KnowledgeArticles" WHERE "TutorialID" = ANY($1::text[])', [[publicArticle, ownDraft, foreignDraft]], { label: 'test.stage6.knowledge.articles.cleanup', write: true }).catch(() => {});
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


test('AI repositories enforce ticket assignment visibility before returning PostgreSQL rows', async () => {
  const userVisible = `ai-visible-${suffix}`;
  const userOther = `ai-other-${suffix}`;
  const visibleTicket = `ai-ticket-visible-${suffix}`;
  const hiddenTicket = `ai-ticket-hidden-${suffix}`;
  const assignmentVisible = `ai-assignment-visible-${suffix}`;
  const assignmentHidden = `ai-assignment-hidden-${suffix}`;
  const clientId = `ai-client-${suffix}`;
  const maintenanceId = `ai-maintenance-${suffix}`;
  const deviceId = `ai-device-${suffix}`;

  try {
    await appendRow('Usuarios', {
      UsuarioID: userVisible,
      NombreCompleto: 'AI Visible Technician',
      NombreUsuario: userVisible,
      Estado: 'ACTIVO',
    });
    await appendRow('Usuarios', {
      UsuarioID: userOther,
      NombreCompleto: 'AI Hidden Technician',
      NombreUsuario: userOther,
      Estado: 'ACTIVO',
    });
    await appendRow('Clientes', {
      ClienteID: clientId,
      Nombre: 'AI Test Client',
      Estado: 'ACTIVO',
      Activo: true,
    });
    await appendRow('Boletas', {
      BoletaUID: visibleTicket,
      BoletaID: `PRUEBA-AI-VISIBLE-${suffix}`,
      EsPrueba: true,
      Titulo: 'AI visible ticket',
      ClienteID: clientId,
      Cliente: 'AI Test Client',
      Estado: 'PENDIENTE',
      Fecha: '2026-09-17',
    });
    await appendRow('Boletas', {
      BoletaUID: hiddenTicket,
      BoletaID: `PRUEBA-AI-HIDDEN-${suffix}`,
      EsPrueba: true,
      Titulo: 'AI hidden ticket',
      ClienteID: clientId,
      Cliente: 'AI Test Client',
      Estado: 'PENDIENTE',
      Fecha: '2026-09-17',
    });
    await appendRow('BoletaAsignados', {
      BoletaAsignadoID: assignmentVisible,
      BoletaUID: visibleTicket,
      UsuarioID: userVisible,
      Activo: true,
    });
    await appendRow('BoletaAsignados', {
      BoletaAsignadoID: assignmentHidden,
      BoletaUID: hiddenTicket,
      UsuarioID: userOther,
      Activo: true,
    });
    await appendRow('Mantenimiento', {
      MantenimientoID: maintenanceId,
      TituloMantenimiento: 'AI Maintenance Test',
      ClienteID: clientId,
      Cliente: 'AI Test Client',
      Estado: 'PENDIENTE',
      Fecha: '2026-09-17',
      Activo: true,
    });
    await appendRow('Evidencia_Mantenimientos', {
      EvidenciaMantenimientoID: deviceId,
      MantenimientoRef: maintenanceId,
      NombreDispositivo: 'AI Camera',
      TipoDispositivo: 'Cámara',
      Estado: 'OPERATIVO',
      Activo: true,
    });

    const [{ searchTickets }, { getStatistics }, { searchMaintenances, getMaintenanceDevices }] = await Promise.all([
      import('../src/ai/agent.repository.tickets.js'),
      import('../src/ai/agent.repository.statistics.js'),
      import('../src/ai/agent.repository.maintenance.js'),
    ]);
    const ctx = {
      user: { UsuarioID: userVisible, NombreCompleto: 'AI Visible Technician' },
      permissions: ['BOLETAS_VER'],
      sessionToken: 'test-session',
    };

    const tickets = await searchTickets(ctx, { status: 'PENDIENTE', dateFrom: '2026-09-17', dateTo: '2026-09-17' });
    assert.equal(tickets.modelData.total, 1);
    assert.deepEqual(tickets.modelData.items.map((item) => item.uid), [visibleTicket]);

    const stats = await getStatistics(ctx, { metric: 'ticket_count', dateFrom: '2026-09-17', dateTo: '2026-09-17' });
    assert.equal(stats.modelData.total, 1);
    assert.equal(stats.modelData.pending, 1);

    const maintenance = await searchMaintenances(ctx, { query: 'AI Maintenance Test' });
    assert.equal(maintenance.modelData.total, 1);
    assert.equal(maintenance.modelData.items[0]?.id, maintenanceId);

    const devices = await getMaintenanceDevices(ctx, { maintenanceId, type: 'cámara' });
    assert.equal(devices.modelData.total, 1);
    assert.equal(devices.modelData.items[0]?.id, deviceId);
  } finally {
    await query('DELETE FROM "Evidencia_Mantenimientos" WHERE "EvidenciaMantenimientoID"=$1', [deviceId], { label: 'test.ai.deviceCleanup', write: true }).catch(() => {});
    await query('DELETE FROM "Mantenimiento" WHERE "MantenimientoID"=$1', [maintenanceId], { label: 'test.ai.maintenanceCleanup', write: true }).catch(() => {});
    await query('DELETE FROM "BoletaAsignados" WHERE "BoletaAsignadoID" = ANY($1::text[])', [[assignmentVisible, assignmentHidden]], { label: 'test.ai.assignmentCleanup', write: true }).catch(() => {});
    await query('DELETE FROM "Boletas" WHERE "BoletaUID" = ANY($1::text[])', [[visibleTicket, hiddenTicket]], { label: 'test.ai.ticketCleanup', write: true }).catch(() => {});
    await query('DELETE FROM "Clientes" WHERE "ClienteID"=$1', [clientId], { label: 'test.ai.clientCleanup', write: true }).catch(() => {});
    await query('DELETE FROM "Usuarios" WHERE "UsuarioID" = ANY($1::text[])', [[userVisible, userOther]], { label: 'test.ai.userCleanup', write: true }).catch(() => {});
  }
});


test('Gemini ticket PREPARE/REVISE/COMMIT creates real pending follow-up tickets once', async () => {
  const id='stage6-ticket-agent-'+suffix;
  const ids={
    user:id+'-user',client:id+'-client',foreignClient:id+'-foreign-client',
    location:id+'-location',foreignLocation:id+'-foreign-location',category:id+'-category',
    failure:id+'-failure',type:id+'-deviceType',
  };
  let operationId='';
  const ctx={
    user:{UsuarioID:ids.user,NombreCompleto:'Técnico agente CI'},
    sessionToken:'stage6-ai-ticket-session',
    permissions:['BOLETAS_CREAR'],
  };
  const twoTickets=[
    {
      title:'Diagnóstico de cámara',client:ids.client,category:ids.category,
      failureType:ids.failure,deviceType:ids.type,deviceName:'Cámara lobby',
      date:'2026-10-26',startTime:'08:00',endTime:'08:30',
      technicians:[ids.user],reason:'Cámara sin imagen',tests:'Se revisó conectividad',
      location:'Sede Central',
      result:'Equipo pendiente de repuesto',
    },
    {
      title:'Regreso por cámara',client:ids.client,category:ids.category,
      failureType:ids.failure,deviceType:ids.type,deviceName:'Cámara lobby',
      date:'2026-10-27',startTime:'09:00',endTime:'11:00',
      technicians:[ids.user],reason:'Seguimiento de cámara',tests:'Se verificó imagen',
      result:'Se restableció imagen',followUpOf:1,
    },
  ];
  try {
    await appendRow('Clientes',{ClienteID:ids.client,Nombre:'Cliente IA de prueba',Estado:'ACTIVO',Activo:true});
    await appendRow('Clientes',{ClienteID:ids.foreignClient,Nombre:'Cliente ajeno IA',Estado:'ACTIVO',Activo:true});
    await appendRow('ClienteUbicaciones',{UbicacionID:ids.location,ClienteID:ids.client,Nombre:'Sede Central',Activo:true});
    await appendRow('ClienteUbicaciones',{UbicacionID:ids.foreignLocation,ClienteID:ids.foreignClient,Nombre:'Sede Central',Activo:true});
    await appendRow('Categorias',{CategoriaID:ids.category,Nombre:'Visita técnica CI',Activo:true});
    await appendRow('TiposFalla',{TipoFallaID:ids.failure,Nombre:'Falla de video CI',Activo:true});
    await appendRow('TiposDispositivo',{TipoDispositivoID:ids.type,Nombre:'Cámara CI',Activo:true});
    await appendRow('Usuarios',{UsuarioID:ids.user,NombreCompleto:'Técnico agente CI',NombreUsuario:'ci-ticket-agent',Estado:'ACTIVO'});

    const {
      prepareTicketBatchCreate,reviseAiTicketOperation,decideAiOperation,getAiOperationStatus,
    }=await import('../src/ai/agent.repository.operations.js');
    await assert.rejects(
      prepareTicketBatchCreate({...ctx,permissions:['BOLETAS_VER']},{tickets:twoTickets}),
      /permiso|crear/i,
    );
    const invalid=await prepareTicketBatchCreate(ctx,{
      tickets:[{...twoTickets[0],client:'Cliente que no existe'}],
    });
    assert.equal(invalid.modelData.ready,false);
    assert.equal(invalid.confirmations,undefined);

    // Dos agentes/requests con la misma sesión y el mismo lote deben obtener
    // una sola propuesta durable aun cuando compitan desde varias instancias.
    const [prep, duplicatePrep]=await Promise.all([
      prepareTicketBatchCreate(ctx,{tickets:twoTickets}),
      prepareTicketBatchCreate(ctx,{tickets:twoTickets}),
    ]);
    assert.equal(duplicatePrep.modelData.operationId,prep.modelData.operationId);
    assert.equal(prep.modelData.ready,true);
    assert.equal(prep.modelData.tickets.length,2);
    assert.equal(prep.modelData.tickets[0].location,'Sede Central');
    operationId=prep.modelData.operationId;
    assert.ok(operationId);

    // El carril rápido de operación.status nunca equivale a autorización:
    // la consulta PostgreSQL debe verificar el usuario Y la sesión.
    const ownedStatus=await getAiOperationStatus(ctx,{operationId});
    assert.equal(ownedStatus.modelData.status,'PENDING');
    await assert.rejects(
      getAiOperationStatus({...ctx,user:{UsuarioID:'different-ai-user'}},{operationId}),
      error=>error.status===404,
    );
    await assert.rejects(
      getAiOperationStatus({...ctx,sessionToken:'different-ai-session'},{operationId}),
      error=>error.status===404,
    );

    const revised=await reviseAiTicketOperation(ctx,{
      operationId,index:1,fields:{endTime:'09:15'},
    });
    assert.equal(revised.status,'PENDING');
    assert.equal(revised.preview.tickets[0].hours,1.25);
    assert.equal(revised.preview.tickets[1].followUpOf,1);

    const first=await decideAiOperation(ctx,{operationId,decision:'confirm'});
    assert.equal(first.status,'COMMITTED');
    assert.equal(first.result.created.length,2);
    assert.equal(first.result.failed.length,0);
    // Simula que la respuesta HTTP de COMMIT se pierde DESPUÉS del commit:
    // el cliente debe recuperar el resultado por estado, sin crear otros IDs.
    const recovered=await getAiOperationStatus(ctx,{operationId});
    assert.equal(recovered.modelData.status,'COMMITTED');
    assert.deepEqual(recovered.modelData.result.created.map(item=>item.id),
      first.result.created.map(item=>item.id));
    const second=await decideAiOperation(ctx,{operationId,decision:'confirm'});
    assert.deepEqual(second.result.created.map(item=>item.id),first.result.created.map(item=>item.id));

    // Simula reinicio de Render DESPUÉS de persistir boletas pero ANTES de
    // marcar COMMITTED: se deja un COMMITTING durable abandonado 11 minutos.
    // La recuperación existente debe reutilizar los UUID, no crear duplicados.
    await query(
      `UPDATE "AiPendingOperations"
          SET "Status"='COMMITTING',"UpdatedAt"=$2
        WHERE "__valid"=TRUE AND "OperationID"=$1`,
      [operationId,new Date(Date.now()-11*60_000).toISOString()],
      {label:'test.ai.ticket.simulatedInterruptedCommit',write:true},
    );
    const resumed=await decideAiOperation(ctx,{operationId,decision:'confirm'});
    assert.equal(resumed.status,'COMMITTED');
    assert.deepEqual(resumed.result.created.map(item=>item.id),
      first.result.created.map(item=>item.id),
      'stale COMMITTING must reconcile deterministic UUIDs instead of duplicating tickets');

    const createdIds=first.result.created.map(row=>row.id);
    const tickets=await query(
      'SELECT "BoletaUID" AS id,"BoletaID" AS number,"Estado" AS status,"GrupoVisitaID" AS group_id,"NumeroVisita" AS visit_number,"HorasTotales" AS hours,"PDFURL" AS pdf,"FirmaArchivoID" AS signature FROM "Boletas" WHERE "__valid"=TRUE AND "BoletaUID"=ANY($1::text[])',
      [createdIds],{label:'test.ai.ticket.persistence'},
    );
    assert.equal(tickets.rowCount,2);
    assert.equal(tickets.rows.every(row=>row.status==='PENDIENTE'),true);
    assert.equal(tickets.rows.every(row=>!row.pdf&&!row.signature),true);
    assert.equal(new Set(tickets.rows.map(row=>row.number)).size,2);
    assert.equal(tickets.rows.some(row=>Number(row.hours)===1.25),true);
    assert.equal(tickets.rows.every(row=>row.group_id),true);
    const assignments=await query(
      'SELECT "BoletaUID" AS id FROM "BoletaAsignados" WHERE "__valid"=TRUE AND "BoletaUID"=ANY($1::text[])',
      [createdIds],{label:'test.ai.ticket.assignments'},
    );
    assert.equal(assignments.rowCount,2);
  } finally {
    // IDs determinísticos sirven incluso si el commit se interrumpió.
    if(operationId){
      const {ticketUuid}=await import('../src/ai/agent.repository.operations.js');
      const createdIds=[0,1].map(index=>ticketUuid(operationId,index));
      await query('DELETE FROM "BoletaAsignados" WHERE "BoletaUID"=ANY($1::text[])',[createdIds],{label:'test.ai.ticket.cleanupAssignments',write:true}).catch(()=>{});
      await query('DELETE FROM "Boletas" WHERE "BoletaUID"=ANY($1::text[])',[createdIds],{label:'test.ai.ticket.cleanupTickets',write:true}).catch(()=>{});
      await query('DELETE FROM "AiPendingOperations" WHERE "OperationID"=$1',[operationId],{label:'test.ai.ticket.cleanupOperation',write:true}).catch(()=>{});
    }
    await query('DELETE FROM "ClienteUbicaciones" WHERE "UbicacionID"=ANY($1::text[])',[[ids.location,ids.foreignLocation]],{label:'test.ai.ticket.cleanupLocations',write:true}).catch(()=>{});
    await query('DELETE FROM "Clientes" WHERE "ClienteID"=ANY($1::text[])',[[ids.client,ids.foreignClient]],{label:'test.ai.ticket.cleanupClients',write:true}).catch(()=>{});
    await query('DELETE FROM "Categorias" WHERE "CategoriaID"=$1',[ids.category],{label:'test.ai.ticket.cleanupCategory',write:true}).catch(()=>{});
    await query('DELETE FROM "TiposFalla" WHERE "TipoFallaID"=$1',[ids.failure],{label:'test.ai.ticket.cleanupFailure',write:true}).catch(()=>{});
    await query('DELETE FROM "TiposDispositivo" WHERE "TipoDispositivoID"=$1',[ids.type],{label:'test.ai.ticket.cleanupDeviceType',write:true}).catch(()=>{});
    await query('DELETE FROM "Usuarios" WHERE "UsuarioID"=$1',[ids.user],{label:'test.ai.ticket.cleanupUser',write:true}).catch(()=>{});
  }
});

test('AI COMMITTING remains recoverable after proposal TTL, while unclaimed PENDING still expires', async () => {
  const { createHash } = await import('node:crypto');
  const { decideAiOperation, getAiOperationStatus } = await import('../src/ai/agent.repository.operations.js');
  const ctx={
    user:{UsuarioID:'stage6-expiration-user'},
    sessionToken:'stage6-expiration-session',
    permissions:['BOLETAS_CREAR'],
  };
  const fingerprint=createHash('sha256').update(ctx.sessionToken).digest('base64url');
  const committingId='stage6-committing-ttl-'+suffix;
  const pendingId='stage6-pending-ttl-'+suffix;
  const now=new Date().toISOString();
  const expiredAt=new Date(Date.now()-60_000).toISOString();
  try {
    for(const [id,status] of [[committingId,'COMMITTING'],[pendingId,'PENDING']]){
      await query(
        `INSERT INTO "AiPendingOperations"
          ("OperationID","UserID","SessionHash","Action","Status","IdempotencyKey",
           "ExpiresAt","CreatedAt","UpdatedAt","__valid")
          VALUES ($1,$2,$3,'TICKET_BATCH_CREATE',$4,$5,$6,$7,$7,TRUE)`,
        [id,ctx.user.UsuarioID,fingerprint,status,id+'-key',expiredAt,now],
        {label:'test.ai.expiredCommit.setup',write:true},
      );
    }
    const confirming=await decideAiOperation(ctx,{operationId:committingId,decision:'confirm'});
    assert.equal(confirming.status,'COMMITTING', 'in-flight commit cannot be marked EXPIRED just because PREPARE TTL elapsed');
    const after=await getAiOperationStatus(ctx,{operationId:committingId});
    assert.equal(after.modelData.status,'COMMITTING');
    await assert.rejects(
      decideAiOperation(ctx,{operationId:pendingId,decision:'confirm'}),
      error=>error.code==='AI_OPERATION_EXPIRED' && error.status===409,
    );
    const pending=await getAiOperationStatus(ctx,{operationId:pendingId});
    assert.equal(pending.modelData.status,'EXPIRED', 'unclaimed proposals still enforce their original TTL');
  } finally {
    await query('DELETE FROM "AiPendingOperations" WHERE "OperationID"=ANY($1::text[])',
      [[committingId,pendingId]],{label:'test.ai.expiredCommit.cleanup',write:true}).catch(()=>{});
  }
});

test('AI recovery and knowledge lookups retain indexed PostgreSQL plans', async () => {
  // EXPLAIN ANALYZE here uses ONLY the disposable TEST_DATABASE_URL from CI.
  // enable_seqscan=off probes index eligibility, not production p95 latency.
  // Never log result rows, sessions, tokens, or SQL parameters.
  const cases=[
    {
      label:'ai.operation.get',
      index:'ux_ai_pending_operations_id',
      sql:`SELECT "OperationID" FROM "AiPendingOperations"
        WHERE "__valid"=TRUE AND "OperationID"=$1 AND "UserID"=$2 AND "SessionHash"=$3 LIMIT 1`,
      params:['missing-id','test-user','test-hash'],
    },
    {
      label:'ai.operation.idempotency',
      index:'ux_ai_pending_operations_idempotency',
      sql:`SELECT "OperationID" FROM "AiPendingOperations"
        WHERE "__valid"=TRUE AND "IdempotencyKey"=$1 ORDER BY "__db_id" DESC LIMIT 1`,
      params:['missing-key'],
    },
    {
      label:'ai.attachments.ownership',
      index:'ux_ai_chat_uploads_id',
      sql:`SELECT "UploadID" FROM "AiChatUploads" WHERE "__valid"=TRUE
        AND "UploadID"=ANY($1::text[]) AND "UserID"=$2 AND "SessionHash"=$3
        AND "Status" IN ('AVAILABLE','CONSUMED')`,
      params:[['missing-upload'],'test-user','test-hash'],
    },
    {
      label:'ai.knowledge.chunksByDocument',
      index:'ix_knowledge_document_chunks_document',
      sql:`SELECT "ChunkID" FROM "KnowledgeDocumentChunks"
        WHERE "__valid"=TRUE AND "DocumentID"=$1 ORDER BY "ChunkIndex" LIMIT 5`,
      params:['missing-document'],
    },
  ];
  await withTransaction(async client=>{
    await client.query('SET LOCAL enable_seqscan=off');
    for(const item of cases){
      const rows=await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+item.sql,item.params);
      const value=rows.rows[0]?.['QUERY PLAN'];
      const report=(Array.isArray(value)?value:JSON.parse(value))[0];
      const indexes=[];
      const walk=node=>{
        if(node['Index Name'])indexes.push(node['Index Name']);
        for(const child of node.Plans||[])walk(child);
      };
      walk(report.Plan);
      // With small CI fixtures PostgreSQL may legitimately prefer another
      // existing B-tree index (e.g. actor_status over the OperationID UNIQUE).
      // Verify schema coverage separately from the chosen access path.
      const indexPresent=await client.query(
        `SELECT 1 FROM pg_indexes
           WHERE schemaname=current_schema() AND indexname=$1 LIMIT 1`,
        [item.index],
      );
      assert.equal(indexPresent.rowCount,1,
        `${item.label}: required migration index ${item.index} is absent`);
      assert.ok(indexes.length,
        `${item.label} must use an index under enable_seqscan=off`);
      assert.ok(Number.isFinite(Number(report['Execution Time'])));
      console.info('[test-ai-query-plan] '+JSON.stringify({
        label:item.label,indexesUsed:indexes,requiredIndex:item.index,
        executionMs:Number(Number(report['Execution Time']).toFixed(3)),
        sharedHitBlocks:Number(report.Plan['Shared Hit Blocks']||0),
      }));
    }
  });
});

test('timed-out AI PostgreSQL reads leave a connection for foreground operations', async (t) => {
  const { env }=await import('../src/config/env.js');
  const { withTimeout,aiToolWorkSnapshot }=await import('../src/ai/agent.service.js');
  if (env.pgPoolMax < 2) {
    t.skip('A single PostgreSQL connection cannot be reserved for foreground traffic');
    return;
  }
  const toolLimit=aiToolWorkSnapshot().max;
  assert.ok(toolLimit <= env.pgPoolMax-1,
    'AI tool work must reserve at least one shared pool connection');

  // Simula consultas SQL que mantienen la conexión tras superar su deadline
  // visible. Nunca requiere tablas ni filas productivas: TEST_DATABASE_URL.
  const stalled=Array.from({length:toolLimit},()=>withTimeout(
    ()=>query('SELECT pg_sleep(1.6)',[],{label:'test.ai.longRunningRead'}),
    75,'test.ai.longRunningRead',
  ));
  try {
    await Promise.all(stalled.map(p=>assert.rejects(
      p,error=>error.code==='AI_TOOL_TIMEOUT' && error.status===504,
    )));
    assert.equal(aiToolWorkSnapshot().active,toolLimit,
      'the timed-out work still owns its real slots');

    // The existing postgres.query pool is shared; unlike a mock semaphore,
    // this foreground query proves a spare DB connection really exists.
    let timer;
    const foreground=Promise.race([
      query('SELECT 1 AS ready',[],{label:'test.ai.foregroundAfterGhost'}),
      new Promise((_,reject)=>{timer=setTimeout(
        ()=>reject(new Error('AI ghost reads exhausted foreground PostgreSQL capacity')),850);
      }),
    ]);
    try {
      const result=await foreground;
      assert.equal(result.rows[0].ready,1);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    // A pg_sleep query is a real DB operation and cannot be aborted merely by
    // the outer Promise deadline. Wait for its actual settlement before exit.
    await new Promise(resolve=>setTimeout(resolve,1750));
    assert.equal(aiToolWorkSnapshot().active,0);
  }
});

test.after(async () => { await closePostgres(); });
