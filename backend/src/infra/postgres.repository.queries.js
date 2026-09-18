import { query, withTransaction } from './postgres.js';
import { _definition as definition, _column as column, _qi as qi, _selectList as selectList, _publicRow as publicRow, _writableValue as writableValue } from './postgres.repository.core.js';
import { notFound } from '../core/errors.js';

function normalizeStatusSql(expr) {
  return `CASE WHEN UPPER(COALESCE(${expr},'')) LIKE '%FINAL%' THEN 'FINALIZADA' WHEN UPPER(COALESCE(${expr},'')) LIKE '%PEND%' THEN 'PENDIENTE' WHEN UPPER(COALESCE(${expr},'')) LIKE '%ANUL%' THEN 'ANULADA' ELSE UPPER(COALESCE(${expr},'')) END`;
}

export async function queryPage(table, payload = {}, { searchFields = [], allowedIds = null, statusNormalized = false, defaultOrder = [], excludeInactive = false, excludeInactiveState = false } = {}) {
  const meta = definition(table);
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  const params = [];
  const clauses = ['"__valid" = TRUE'];
  if (excludeInactive && meta.columns.includes('Activo') && payload.activo === undefined) clauses.push(`LOWER(COALESCE("Activo",'true')) <> 'false'`);
  if (excludeInactiveState && meta.columns.includes('Estado')) clauses.push(`UPPER(COALESCE("Estado",'ACTIVO')) <> 'INACTIVO'`);
  const eq = [['clienteId','ClienteID'],['ubicacionId','UbicacionID'],['ubicacionEquipoId','UbicacionEquipoID'],['categoriaId','CategoriaID'],['tipoDispositivoId','TipoDispositivoID'],['fabricanteId','FabricanteID'],['modeloId','ModeloID']];
  for (const [key,col] of eq) if (payload[key] && meta.columns.includes(col)) { params.push(String(payload[key])); clauses.push(`${qi(col)}=$${params.length}`); }
  if (payload.activo !== undefined && meta.columns.includes('Activo')) { params.push(String(payload.activo).toLowerCase()); clauses.push(`LOWER(COALESCE("Activo",''))=$${params.length}`); }
  if ((payload.estado || payload.status) && meta.columns.includes('Estado')) {
    const requested = String(payload.estado || payload.status).toUpperCase();
    params.push(requested.includes('FINAL')?'FINALIZADA':requested.includes('PEND')?'PENDIENTE':requested.includes('ANUL')?'ANULADA':requested);
    clauses.push(`${statusNormalized ? normalizeStatusSql('"Estado"') : 'UPPER(COALESCE("Estado",\'\'))'}=$${params.length}`);
  }
  if (payload.dateFrom && meta.columns.includes('Fecha')) { params.push(String(payload.dateFrom)); clauses.push(`LEFT(COALESCE("Fecha",''),10) >= $${params.length}`); }
  if (payload.dateTo && meta.columns.includes('Fecha')) { params.push(String(payload.dateTo)); clauses.push(`LEFT(COALESCE("Fecha",''),10) <= $${params.length}`); }
  const search = String(payload.search || payload.q || '').trim();
  if (search && searchFields.length) {
    const valid = searchFields.filter((field) => meta.columns.includes(field));
    if (valid.length) { params.push(`%${search}%`); clauses.push(`(${valid.map((field) => `COALESCE(${qi(field)},'') ILIKE $${params.length}`).join(' OR ')})`); }
  }
  if (allowedIds && allowedIds.size && meta.columns.includes(meta.id)) { params.push([...allowedIds].map(String)); clauses.push(`${qi(meta.id)}=ANY($${params.length}::text[])`); }
  else if (allowedIds && allowedIds.size === 0) return { items: [], total: 0, page, pageSize };
  const where = clauses.join(' AND ');
  const countResult = await query(`SELECT COUNT(*)::bigint AS total FROM ${qi(table)} WHERE ${where}`, params, { label: `page.count.${table}` });
  const order = [];
  if (payload.sortBy && meta.columns.includes(String(payload.sortBy))) order.push(`${qi(payload.sortBy)} ${String(payload.sortDir).toLowerCase()==='desc'?'DESC':'ASC'}`);
  else for (const [field,direction='ASC',numeric=false] of defaultOrder) if (meta.columns.includes(field)) order.push(`${numeric ? `NULLIF(${qi(field)},'')::numeric` : qi(field)} ${String(direction).toUpperCase()==='DESC'?'DESC':'ASC'} NULLS LAST`);
  order.push('"__db_id" ASC');
  const itemParams=[...params,pageSize,(page-1)*pageSize];
  const rows = await query(`SELECT ${selectList(table)} FROM ${qi(table)} WHERE ${where} ORDER BY ${order.join(', ')} LIMIT $${itemParams.length-1} OFFSET $${itemParams.length}`, itemParams, { label: `page.items.${table}` });
  return { items: rows.rows.map(publicRow), total: Number(countResult.rows[0]?.total || 0), page, pageSize };
}

export async function queryTicketPage(payload = {}, { assignedUserId = '', allowedIds = null } = {}) {
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  const params = [];
  const statusSql = normalizeStatusSql('"Estado"');
  const clauses = [
    '"__valid" = TRUE',
    `LOWER(COALESCE("Activo", 'true')) <> 'false'`,
    `${statusSql} <> 'ANULADA'`,
  ];

  // allowedIds is the authorization gate used by ticket-visibility.patch.js.
  // Keep it in SQL so technicians never materialize or filter the full ticket set.
  if (allowedIds instanceof Set) {
    if (!allowedIds.size) return {
      items: [],
      total: 0,
      page,
      pageSize,
      ...(payload.homeSummary ? { homeSummary: { pending: 0, finished: 0 } } : {}),
    };
    params.push([...allowedIds].map(String));
    clauses.push(`"BoletaUID"=ANY(${params.length}::text[])`);
  }

  const assigned = String(assignedUserId || '').trim();
  if (assigned) {
    params.push(assigned);
    clauses.push(`EXISTS (
      SELECT 1
      FROM "BoletaAsignados" ba
      WHERE ba."__valid"=TRUE
        AND ba."BoletaUID"="Boletas"."BoletaUID"
        AND ba."UsuarioID"=$${params.length}
        AND LOWER(COALESCE(ba."Activo",'true')) <> 'false'
    )`);
  }

  const exact = [
    ['clienteId', 'ClienteID'], ['categoriaId', 'CategoriaID'],
    ['tipoDispositivoId', 'TipoDispositivoID'], ['fabricanteId', 'FabricanteID'], ['modeloId', 'ModeloID'],
  ];
  for (const [key, field] of exact) {
    const expected = String(payload[key] || '').trim();
    if (!expected) continue;
    params.push(expected);
    clauses.push(`BTRIM(COALESCE(${qi(field)},''))=$${params.length}`);
    // Historical selectTicketPage applies the original untrimmed ClienteID check twice.
    if (key === 'clienteId') {
      params.push(String(payload[key]));
      clauses.push(`COALESCE("ClienteID",'')=$${params.length}`);
    }
  }

  const active = payload.activo === undefined ? null : String(payload.activo).toLowerCase();
  if (active !== null) {
    params.push(active);
    clauses.push(`LOWER(COALESCE("Activo",''))=$${params.length}`);
  }
  if (payload.dateFrom) {
    params.push(String(payload.dateFrom));
    clauses.push(`LEFT(COALESCE("Fecha",''),10) >= $${params.length}`);
  }
  if (payload.dateTo) {
    params.push(String(payload.dateTo));
    clauses.push(`LEFT(COALESCE("Fecha",''),10) <= $${params.length}`);
  }

  const search = String(payload.search || payload.q || '').trim();
  if (search) {
    params.push(`%${search}%`);
    const fields = ['Titulo','Cliente','Ubicacion','Categoria','TipoDispositivo','Fabricante','Modelo','BoletaID'];
    clauses.push(`(${fields.map((field) => `COALESCE(${qi(field)},'') ILIKE $${params.length}`).join(' OR ')})`);
  }

  // Home summary is calculated after visibility/date/catalog/search filters and
  // before the requested status, matching selectTicketPage exactly.
  let homeSummary = null;
  if (payload.homeSummary) {
    const summaryWhere = clauses.join(' AND ');
    const summary = await query(
      `SELECT
        COUNT(*) FILTER (WHERE ${statusSql}='PENDIENTE')::bigint AS pending,
        COUNT(*) FILTER (WHERE ${statusSql}='FINALIZADA')::bigint AS finished
       FROM "Boletas" WHERE ${summaryWhere}`,
      params,
      { label: 'tickets.homeSummary' },
    );
    homeSummary = {
      pending: Number(summary.rows[0]?.pending || 0),
      finished: Number(summary.rows[0]?.finished || 0),
    };
  }

  const requestedStatus = String(payload.status || payload.estado || '').trim().toUpperCase();
  const itemParams = [...params];
  const itemClauses = [...clauses];
  if (requestedStatus) {
    const normalized = requestedStatus.includes('FINAL') ? 'FINALIZADA'
      : requestedStatus.includes('PEND') ? 'PENDIENTE'
        : requestedStatus.includes('ANUL') ? 'ANULADA'
          : requestedStatus;
    itemParams.push(normalized);
    itemClauses.push(`${statusSql}=$${itemParams.length}`);
  }

  const where = itemClauses.join(' AND ');
  const count = await query(
    `SELECT COUNT(*)::bigint AS total FROM "Boletas" WHERE ${where}`,
    itemParams,
    { label: 'tickets.list.count' },
  );

  // Preserve selectTicketPage ordering: date desc, numeric ticket number desc,
  // creation/update timestamp desc, then original source order.
  const order = [
    `LEFT(COALESCE(NULLIF("Fecha",''),NULLIF("FechaCreacion",''),''),10) DESC`,
    `CASE WHEN "BoletaID" ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN "BoletaID"::numeric ELSE 0 END DESC`,
    `COALESCE(NULLIF("FechaCreacion",''),NULLIF("FechaActualizacion",''),'') DESC`,
    `COALESCE("__source_row_number","__db_id") ASC`,
  ].join(', ');

  const pageParams = [...itemParams, pageSize, (page - 1) * pageSize];
  const rows = await query(
    `SELECT ${selectList('Boletas')} FROM "Boletas"
     WHERE ${where}
     ORDER BY ${order}
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
    { label: 'tickets.list.items' },
  );
  const result = {
    items: rows.rows.map(publicRow),
    total: Number(count.rows[0]?.total || 0),
    page,
    pageSize,
  };
  return homeSummary ? { ...result, homeSummary } : result;
}

export async function queryAgendaTickets({ dates = [], ticketIds = [] } = {}) {
  const normalizedDates = [...new Set((dates || []).map((value) => String(value || '').slice(0, 10)).filter(Boolean))];
  const normalizedIds = [...new Set((ticketIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!normalizedDates.length && !normalizedIds.length) return [];
  const params = [];
  const alternatives = [];
  if (normalizedDates.length) {
    params.push(normalizedDates);
    alternatives.push(`LEFT(COALESCE("Fecha",''),10)=ANY($${params.length}::text[])`);
  }
  if (normalizedIds.length) {
    params.push(normalizedIds);
    alternatives.push(`"BoletaUID"=ANY($${params.length}::text[])`);
  }
  const result = await query(
    `SELECT ${selectList('Boletas')} FROM "Boletas"
     WHERE "__valid"=TRUE AND (${alternatives.join(' OR ')})
     ORDER BY "__db_id" ASC`,
    params,
    { label: 'agenda.ticketCandidates' },
  );
  return result.rows.map(publicRow);
}

export async function queryKnowledgeArticlePage(payload = {}, { viewerUserId = '', canManage = false } = {}) {
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  const params = [];
  const clauses = ['a."__valid"=TRUE', `LOWER(COALESCE(a."Activo",'true')) <> 'false'`];
  const published = `UPPER(COALESCE(NULLIF(a."Estado",''),'PUBLICADO'))='PUBLICADO'`;
  const includeDrafts = ['true','1','si','sí','yes','on'].includes(String(payload.includeDrafts ?? '').trim().toLowerCase());
  const viewer = String(viewerUserId || '').trim();
  if (!includeDrafts) clauses.push(published);
  else if (!canManage) {
    params.push(viewer);
    clauses.push(`(${published} OR a."AutorUsuarioID"=$${params.length})`);
  }

  const requestedAuthor = String(payload.autorUsuarioId || payload.AutorUsuarioID || '').trim();
  if (requestedAuthor) {
    params.push(requestedAuthor);
    clauses.push(`a."AutorUsuarioID"=$${params.length}`);
  }

  const requestedCategory = String(payload.categoriaId || payload.CategoriaConocimientoID || '').trim();
  if (requestedCategory) {
    params.push(requestedCategory);
    const p = `$${params.length}`;
    clauses.push(`(
      EXISTS (
        SELECT 1 FROM "KnowledgeArticleCategories" rel
        WHERE rel."__valid"=TRUE
          AND rel."TutorialID"=a."TutorialID"
          AND rel."CategoriaConocimientoID"=${p}
          AND LOWER(COALESCE(rel."Activo",'true')) <> 'false'
          AND UPPER(COALESCE(rel."Estado",'')) <> 'INACTIVO'
      )
      OR (
        a."CategoriaConocimientoID"=${p}
        AND NOT EXISTS (
          SELECT 1 FROM "KnowledgeArticleCategories" rel_any
          WHERE rel_any."__valid"=TRUE
            AND rel_any."TutorialID"=a."TutorialID"
            AND LOWER(COALESCE(rel_any."Activo",'true')) <> 'false'
            AND UPPER(COALESCE(rel_any."Estado",'')) <> 'INACTIVO'
        )
      )
    )`);
  }

  const search = String(payload.search || payload.q || '').trim();
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    clauses.push(`(
      COALESCE(a."Titulo",'') ILIKE ${p}
      OR COALESCE(a."ProblemaResuelto",'') ILIKE ${p}
      OR COALESCE(a."ContenidoHTML",'') ILIKE ${p}
      OR EXISTS (
        SELECT 1
        FROM "KnowledgeArticleCategories" rel
        JOIN "KnowledgeCategories" cat
          ON cat."__valid"=TRUE AND cat."CategoriaConocimientoID"=rel."CategoriaConocimientoID"
        WHERE rel."__valid"=TRUE
          AND rel."TutorialID"=a."TutorialID"
          AND LOWER(COALESCE(rel."Activo",'true')) <> 'false'
          AND UPPER(COALESCE(rel."Estado",'')) <> 'INACTIVO'
          AND COALESCE(cat."Nombre",'') ILIKE ${p}
      )
      OR EXISTS (
        SELECT 1 FROM "KnowledgeCategories" legacy_cat
        WHERE legacy_cat."__valid"=TRUE
          AND legacy_cat."CategoriaConocimientoID"=a."CategoriaConocimientoID"
          AND COALESCE(legacy_cat."Nombre",'') ILIKE ${p}
      )
      OR EXISTS (
        SELECT 1 FROM "Usuarios" author
        WHERE author."__valid"=TRUE
          AND author."UsuarioID"=a."AutorUsuarioID"
          AND (
            COALESCE(author."NombreCompleto",'') ILIKE ${p}
            OR COALESCE(author."NombreUsuario",'') ILIKE ${p}
          )
      )
    )`);
  }

  const where = clauses.join(' AND ');
  const count = await query(
    `SELECT COUNT(*)::bigint AS total FROM "KnowledgeArticles" a WHERE ${where}`,
    params,
    { label: 'knowledge.list.count' },
  );
  const pageParams = [...params, pageSize, (page - 1) * pageSize];
  const rows = await query(
    `SELECT ${selectList('KnowledgeArticles','a')}
     FROM "KnowledgeArticles" a
     WHERE ${where}
     ORDER BY a."__db_id" ASC
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
    { label: 'knowledge.list.items' },
  );
  return {
    items: rows.rows.map(publicRow),
    total: Number(count.rows[0]?.total || 0),
    page,
    pageSize,
  };
}

export async function queryMaintenanceHomeSummary(payload = {}) {
  const params = [];
  const clauses = ['"__valid"=TRUE', `LOWER(COALESCE("Activo",'true')) <> 'false'`];
  if (payload.activo !== undefined) {
    params.push(String(payload.activo).toLowerCase());
    clauses.push(`LOWER(COALESCE("Activo",''))=$${params.length}`);
  }
  const result = await query(
    `SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE UPPER(COALESCE("Estado",''))='PENDIENTE')::bigint AS pending,
      COUNT(*) FILTER (WHERE UPPER(COALESCE("Estado",''))='FINALIZADO')::bigint AS finished
     FROM "Mantenimiento"
     WHERE ${clauses.join(' AND ')}`,
    params,
    { label: 'maintenance.homeSummary' },
  );
  const row = result.rows[0] || {};
  return {
    items: [],
    total: Number(row.total || 0),
    page: 1,
    pageSize: 0,
    homeSummary: {
      pending: Number(row.pending || 0),
      finished: Number(row.finished || 0),
    },
  };
}

export async function nextCustomerCaseNumber() {
  const result = await query(
    `SELECT COALESCE(MAX(
      CASE
        WHEN regexp_replace(COALESCE("CasoNumero",''),'[^0-9]','','g') ~ '^[0-9]+$'
        THEN regexp_replace("CasoNumero",'[^0-9]','','g')::bigint
        ELSE 0
      END
    ),0)+1 AS value
    FROM "CasosClientes"
    WHERE "__valid"=TRUE`,
    [],
    { label: 'cases.nextNumber' },
  );
  return `CAS-${String(Number(result.rows[0]?.value || 1)).padStart(6, '0')}`;
}

export async function queryCustomerCasePage(payload = {}) {
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(payload.pageSize || 60)));
  const normalize = `CASE WHEN UPPER(REPLACE(COALESCE("Estado",''),' ','_')) IN ('EN_ESPERA','ESPERA','PENDIENTE') THEN 'EN_ESPERA' WHEN UPPER(REPLACE(COALESCE("Estado",''),' ','_')) IN ('EN_PROCESO','PROCESO') THEN 'EN_PROCESO' WHEN UPPER(REPLACE(COALESCE("Estado",''),' ','_')) IN ('FINALIZADO','FINALIZADA','FINAL') THEN 'FINALIZADO' ELSE 'EN_ESPERA' END`;
  const base = [`"__valid"=TRUE`, `LOWER(COALESCE("Activo",'true')) <> 'false'`];
  const countResult = await query(`SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE ${normalize}='EN_ESPERA')::bigint AS espera, COUNT(*) FILTER (WHERE ${normalize}='EN_PROCESO')::bigint AS proceso, COUNT(*) FILTER (WHERE ${normalize}='FINALIZADO')::bigint AS finalizado FROM "CasosClientes" WHERE ${base.join(' AND ')}`, [], { label: 'cases.counts' });
  const params = []; const clauses = [...base];
  const state = String(payload.status || payload.estado || '').trim();
  if (state) { const key=state.toUpperCase().replace(/[\s-]+/g,'_'); const normalized=['ESPERA','PENDIENTE'].includes(key)?'EN_ESPERA':['PROCESO'].includes(key)?'EN_PROCESO':['FINALIZADA','FINAL'].includes(key)?'FINALIZADO':key; params.push(normalized); clauses.push(`${normalize}=$${params.length}`); }
  const clientId=String(payload.clientId||payload.ClienteID||'').trim(); if(clientId){params.push(clientId);clauses.push(`"ClienteID"=$${params.length}`);}
  const search=String(payload.search||payload.q||'').trim(); if(search){params.push(`%${search}%`);clauses.push(`LOWER(CONCAT_WS(' ',COALESCE("CasoNumero",''),COALESCE("Cliente",''),COALESCE("RazonVisita",''),COALESCE("Problema",''),COALESCE("NombreSolicitante",''),COALESCE("CorreoSolicitante",''))) LIKE LOWER($${params.length})`);}
  const where=clauses.join(' AND '); const total=await query(`SELECT COUNT(*)::bigint AS total FROM "CasosClientes" WHERE ${where}`,params,{label:'cases.list.count'}); const pageParams=[...params,pageSize,(page-1)*pageSize];
  const rows=await query(`SELECT ${selectList('CasosClientes')} FROM "CasosClientes" WHERE ${where} ORDER BY "FechaCreacion" DESC NULLS LAST, "__db_id" ASC LIMIT $${pageParams.length-1} OFFSET $${pageParams.length}`,pageParams,{label:'cases.list.items'});
  const c=countResult.rows[0]||{}; return {items:rows.rows.map(publicRow),total:Number(total.rows[0]?.total||0),page,pageSize,counts:{EN_ESPERA:Number(c.espera||0),EN_PROCESO:Number(c.proceso||0),FINALIZADO:Number(c.finalizado||0),TOTAL:Number(c.total||0)}};
}

export async function countRows(table, criteria = {}) {
  const params=[]; const clauses=['"__valid"=TRUE'];
  for (const [key,value] of Object.entries(criteria)) { column(table,key); params.push(writableValue(value)); clauses.push(`${qi(key)}=$${params.length}`); }
  const result=await query(`SELECT COUNT(*)::bigint AS total FROM ${qi(table)} WHERE ${clauses.join(' AND ')}`,params,{label:`count.${table}`});
  return Number(result.rows[0]?.total||0);
}

export async function maxNumericValue(table, name) {
  column(table,name);
  const result=await query(`SELECT MAX(CASE WHEN ${qi(name)} ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN ${qi(name)}::numeric END) AS value FROM ${qi(table)} WHERE "__valid"=TRUE`,[],{label:`max.${table}.${name}`});
  return Number(result.rows[0]?.value||0);
}

export async function allocateConsecutive(entity, { actor = '', defaultNext = 1 } = {}) {
  return withTransaction(async () => {
    const selected=await query('SELECT "__db_id", "__payload", "SiguienteNumero", "Prefijo" FROM "Consecutivos" WHERE "__valid"=TRUE AND "Entidad"=$1 ORDER BY "__db_id" DESC LIMIT 1 FOR UPDATE',[String(entity)],{label:'consecutive.lock'});
    if (!selected.rows[0]) throw notFound(`No se encontró el consecutivo ${entity}.`);
    const db=selected.rows[0]; const payload={...(db.__payload||{})};
    const current=Number(db.SiguienteNumero||payload.SiguienteNumero||defaultNext);
    const next=current+1; const now=new Date().toISOString();
    Object.assign(payload,{SiguienteNumero:next,UltimoNumeroUsado:current,FechaActualizacion:now,ActualizadoPor:actor});
    await query('UPDATE "Consecutivos" SET "SiguienteNumero"=$1,"UltimoNumeroUsado"=$2,"FechaActualizacion"=$3,"ActualizadoPor"=$4,"__payload"=$5::jsonb WHERE "__db_id"=$6',[String(next),String(current),now,String(actor||''),JSON.stringify(payload),db.__db_id],{label:'consecutive.update',write:true});
    return { numero: current, prefijo: String(db.Prefijo||payload.Prefijo||''), siguienteNumero: next };
  });
}

export function filterRows(rows, payload = {}, searchFields = []) {
  const search=String(payload.search||payload.q||'').trim().toLowerCase(); const active=payload.activo===undefined?null:String(payload.activo).toLowerCase();
  const state=payload.estado?String(payload.estado).toUpperCase():''; const client=payload.clienteId?String(payload.clienteId):'';
  const page=Math.max(1,Number(payload.page||1)); const pageSize=Math.min(1000,Math.max(1,Number(payload.pageSize||100))); const start=Math.trunc((page-1)*pageSize)||0; const end=Math.trunc(page*pageSize)||0;
  const result=[]; let total=0;
  for(const row of rows){ if(active!==null&&String(row.Activo).toLowerCase()!==active)continue; if(payload.estado&&String(row.Estado||'').toUpperCase()!==state)continue; if(payload.clienteId&&String(row.ClienteID||row.ClienteRef||'')!==client)continue; if(search&&!searchFields.some((field)=>String(row[field]||'').toLowerCase().includes(search)))continue; if(payload.sortBy||(total>=start&&total<end))result.push(row); total+=1; }
  let items=result; if(payload.sortBy){const direction=String(payload.sortDir).toLowerCase()==='desc'?-1:1; result.sort((a,b)=>String(a[payload.sortBy]||'').localeCompare(String(b[payload.sortBy]||''),'es')*direction); items=result.slice(start,end);}
  return {items:items.map(({__rowNumber,...row})=>row),total,page,pageSize};
}

