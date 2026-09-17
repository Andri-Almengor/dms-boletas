import { scriptPool } from './db-script.js';

const pool = scriptPool();
const client = await pool.connect();
const migrationRun = '00000000-0000-0000-0000-000000000001';
const results = [];

async function explain(name, sql, params = []) {
  const started = performance.now();
  const response = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const wallMs = performance.now() - started;
  const planRoot = response.rows[0]?.['QUERY PLAN']?.[0] || {};
  const plan = planRoot.Plan || {};
  results.push({
    name,
    planningMs: Number(planRoot['Planning Time'] || 0),
    executionMs: Number(planRoot['Execution Time'] || 0),
    wallMs: Number(wallMs.toFixed(3)),
    planNode: plan['Node Type'] || '',
    relation: plan['Relation Name'] || '',
    actualRows: Number(plan['Actual Rows'] || 0),
    sharedHitBlocks: Number(plan['Shared Hit Blocks'] || 0),
    sharedReadBlocks: Number(plan['Shared Read Blocks'] || 0),
  });
}

try {
  await client.query('BEGIN');

  // Synthetic scale is close to the supplied workbook for ticket hot paths and
  // intentionally lives inside a rolled-back transaction. No production data,
  // credentials, hashes, or URLs are used.
  await client.query(`
    INSERT INTO "Clientes" ("ClienteID","Nombre","Estado","Activo","__payload","__migration_run_id")
    SELECT 'bench-client-'||g, 'Cliente '||g, 'ACTIVO', 'true', jsonb_build_object('ClienteID','bench-client-'||g,'Nombre','Cliente '||g,'Estado','ACTIVO','Activo',true), $1::uuid
    FROM generate_series(1,200) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "Usuarios" ("UsuarioID","NombreUsuario","NombreCompleto","Estado","__payload","__migration_run_id")
    SELECT 'bench-user-'||g, 'user'||g, 'Técnico '||g, 'ACTIVO', jsonb_build_object('UsuarioID','bench-user-'||g,'NombreUsuario','user'||g,'NombreCompleto','Técnico '||g,'Estado','ACTIVO'), $1::uuid
    FROM generate_series(1,40) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "Boletas" ("BoletaUID","BoletaID","Titulo","ClienteID","Cliente","Estado","Fecha","__payload","__migration_run_id")
    SELECT 'bench-ticket-'||g, g::text, 'Boleta '||g, 'bench-client-'||((g-1)%200+1), 'Cliente '||((g-1)%200+1),
      CASE WHEN g%3=0 THEN 'FINALIZADA' ELSE 'PENDIENTE' END,
      to_char(DATE '2026-01-01' + ((g-1)%250), 'YYYY-MM-DD'),
      jsonb_build_object('BoletaUID','bench-ticket-'||g,'BoletaID',g,'Titulo','Boleta '||g,'ClienteID','bench-client-'||((g-1)%200+1),'Estado',CASE WHEN g%3=0 THEN 'FINALIZADA' ELSE 'PENDIENTE' END),
      $1::uuid
    FROM generate_series(1,1000) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "BoletaAsignados" ("BoletaAsignadoID","BoletaUID","UsuarioID","Activo","__payload","__migration_run_id")
    SELECT 'bench-assignment-'||g, 'bench-ticket-'||((g-1)%1000+1), 'bench-user-'||((g-1)%40+1), 'true',
      jsonb_build_object('BoletaAsignadoID','bench-assignment-'||g,'BoletaUID','bench-ticket-'||((g-1)%1000+1),'UsuarioID','bench-user-'||((g-1)%40+1),'Activo',true), $1::uuid
    FROM generate_series(1,2500) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "EvidenciasBoleta" ("EvidenciaID","BoletaUID","Nombre","Orden","Activo","__payload","__migration_run_id")
    SELECT 'bench-evidence-'||g, 'bench-ticket-'||((g-1)%1000+1), 'Evidencia '||g, ((g-1)%20)::text, 'true',
      jsonb_build_object('EvidenciaID','bench-evidence-'||g,'BoletaUID','bench-ticket-'||((g-1)%1000+1),'Nombre','Evidencia '||g,'Activo',true), $1::uuid
    FROM generate_series(1,3000) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "Mantenimiento" ("MantenimientoID","ClienteID","Cliente","Estado","Fecha","Activo","__payload","__migration_run_id")
    SELECT 'bench-maint-'||g, 'bench-client-'||((g-1)%200+1), 'Cliente '||((g-1)%200+1), CASE WHEN g%4=0 THEN 'FINALIZADO' ELSE 'PENDIENTE' END,
      to_char(DATE '2026-01-01' + ((g-1)%250), 'YYYY-MM-DD'), 'true', jsonb_build_object('MantenimientoID','bench-maint-'||g,'Estado',CASE WHEN g%4=0 THEN 'FINALIZADO' ELSE 'PENDIENTE' END,'Activo',true), $1::uuid
    FROM generate_series(1,250) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "Evidencia_Mantenimientos" ("EvidenciaMantenimientoID","MantenimientoRef","NombreDispositivo","Activo","__payload","__migration_run_id")
    SELECT 'bench-device-'||g, 'bench-maint-'||((g-1)%250+1), 'Dispositivo '||g, 'true', jsonb_build_object('EvidenciaMantenimientoID','bench-device-'||g,'MantenimientoRef','bench-maint-'||((g-1)%250+1),'Activo',true), $1::uuid
    FROM generate_series(1,1000) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "Agendas" ("AgendaID","ClienteID","Fecha","Estado","__payload","__migration_run_id")
    SELECT 'bench-agenda-'||g, 'bench-client-'||((g-1)%200+1), to_char(DATE '2026-01-01' + ((g-1)%250), 'YYYY-MM-DD'), 'PENDIENTE', jsonb_build_object('AgendaID','bench-agenda-'||g,'Fecha',to_char(DATE '2026-01-01' + ((g-1)%250), 'YYYY-MM-DD'),'Estado','PENDIENTE'), $1::uuid
    FROM generate_series(1,300) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "KnowledgeArticles" ("TutorialID","Titulo","Estado","Activo","AutorUsuarioID","__payload","__migration_run_id")
    SELECT 'bench-knowledge-'||g, 'Artículo '||g, CASE WHEN g%5=0 THEN 'BORRADOR' ELSE 'PUBLICADO' END, 'true', 'bench-user-'||((g-1)%40+1), jsonb_build_object('TutorialID','bench-knowledge-'||g,'Titulo','Artículo '||g,'Estado',CASE WHEN g%5=0 THEN 'BORRADOR' ELSE 'PUBLICADO' END,'Activo',true), $1::uuid
    FROM generate_series(1,120) g
  `, [migrationRun]);

  await client.query(`
    INSERT INTO "CasosClientes" ("CasoID","ClienteID","Estado","FechaCreacion","Activo","__payload","__migration_run_id")
    SELECT 'bench-case-'||g, 'bench-client-'||((g-1)%200+1), CASE WHEN g%3=0 THEN 'FINALIZADO' WHEN g%3=1 THEN 'EN_ESPERA' ELSE 'EN_PROCESO' END, to_char(TIMESTAMP '2026-01-01' + (g||' hours')::interval, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'true', jsonb_build_object('CasoID','bench-case-'||g,'Estado',CASE WHEN g%3=0 THEN 'FINALIZADO' WHEN g%3=1 THEN 'EN_ESPERA' ELSE 'EN_PROCESO' END,'Activo',true), $1::uuid
    FROM generate_series(1,200) g
  `, [migrationRun]);

  await client.query('ANALYZE "Boletas"');
  await client.query('ANALYZE "BoletaAsignados"');
  await client.query('ANALYZE "EvidenciasBoleta"');
  await client.query('ANALYZE "Mantenimiento"');
  await client.query('ANALYZE "Evidencia_Mantenimientos"');
  await client.query('ANALYZE "Clientes"');
  await client.query('ANALYZE "Agendas"');
  await client.query('ANALYZE "KnowledgeArticles"');
  await client.query('ANALYZE "CasosClientes"');

  await explain('HOME', `SELECT COUNT(*) FILTER (WHERE "Estado"='PENDIENTE'), COUNT(*) FILTER (WHERE "Estado"='FINALIZADA') FROM "Boletas" WHERE "__valid"=TRUE`);
  await explain('PENDIENTES', `SELECT "__payload" FROM "Boletas" WHERE "__valid"=TRUE AND "Estado"='PENDIENTE' ORDER BY "Fecha" DESC LIMIT 100`);
  await explain('FINALIZADAS', `SELECT "__payload" FROM "Boletas" WHERE "__valid"=TRUE AND "Estado"='FINALIZADA' ORDER BY "Fecha" DESC LIMIT 100`);
  await explain('DETALLE_BOLETA', `SELECT "__payload" FROM "Boletas" WHERE "__valid"=TRUE AND "BoletaUID"=$1 LIMIT 1`, ['bench-ticket-500']);
  await explain('DETALLE_ASIGNADOS', `SELECT "__payload" FROM "BoletaAsignados" WHERE "__valid"=TRUE AND "BoletaUID"=$1 AND LOWER(COALESCE("Activo",'true')) <> 'false'`, ['bench-ticket-500']);
  await explain('DETALLE_EVIDENCIAS', `SELECT "__payload" FROM "EvidenciasBoleta" WHERE "__valid"=TRUE AND "BoletaUID"=$1 AND LOWER(COALESCE("Activo",'true')) <> 'false' ORDER BY "Orden"`, ['bench-ticket-500']);
  await explain('MANTENIMIENTOS', `SELECT "__payload" FROM "Mantenimiento" WHERE "__valid"=TRUE AND "Estado"='PENDIENTE' ORDER BY "Fecha" DESC LIMIT 100`);
  await explain('MANTENIMIENTO_DISPOSITIVOS', `SELECT "__payload" FROM "Evidencia_Mantenimientos" WHERE "__valid"=TRUE AND "MantenimientoRef"=$1`, ['bench-maint-100']);
  await explain('CLIENTES', `SELECT "__payload" FROM "Clientes" WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false' ORDER BY "Nombre" LIMIT 100`);
  await explain('AGENDA', `SELECT "__payload" FROM "Agendas" WHERE "__valid"=TRUE AND "Fecha" BETWEEN $1 AND $2 ORDER BY "Fecha" LIMIT 100`, ['2026-03-01','2026-06-30']);
  await explain('KNOWLEDGE', `SELECT "__payload" FROM "KnowledgeArticles" WHERE "__valid"=TRUE AND "Estado"='PUBLICADO' ORDER BY "TutorialID" LIMIT 60`);
  await explain('CASES', `SELECT "__payload" FROM "CasosClientes" WHERE "__valid"=TRUE AND "Estado"='EN_ESPERA' ORDER BY "FechaCreacion" DESC LIMIT 60`);

  console.log(JSON.stringify({ synthetic: true, generatedAt: new Date().toISOString(), scale: { tickets: 1000, assignments: 2500, evidences: 3000, maintenances: 250, maintenanceDevices: 1000, clients: 200, agendas: 300, knowledge: 120, cases: 200 }, queries: results }, null, 2));
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
