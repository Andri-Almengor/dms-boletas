import { query } from '../infra/postgres.js';
import { customerCaseView } from './customer-case-query.service.js';

function clean(value) { return String(value ?? '').trim(); }

export async function materializeCustomerCaseDelta(_ctx, events = []) {
  const ids=[...new Set((events||[]).map((event)=>clean(event?.EntityID)).filter(Boolean))];
  const normalize=`CASE WHEN UPPER(REPLACE(COALESCE("Estado",''),' ','_')) IN ('EN_ESPERA','ESPERA','PENDIENTE') THEN 'EN_ESPERA' WHEN UPPER(REPLACE(COALESCE("Estado",''),' ','_')) IN ('EN_PROCESO','PROCESO') THEN 'EN_PROCESO' WHEN UPPER(REPLACE(COALESCE("Estado",''),' ','_')) IN ('FINALIZADO','FINALIZADA','FINAL') THEN 'FINALIZADO' ELSE 'EN_ESPERA' END`;
  const countsResult=await query(`SELECT COUNT(*)::bigint AS total,COUNT(*) FILTER (WHERE ${normalize}='EN_ESPERA')::bigint AS espera,COUNT(*) FILTER (WHERE ${normalize}='EN_PROCESO')::bigint AS proceso,COUNT(*) FILTER (WHERE ${normalize}='FINALIZADO')::bigint AS finalizado FROM "CasosClientes" WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",'true')) <> 'false'`,[],{label:'sync.cases.counts'});
  const byId=new Map();
  if(ids.length){
    const rows=await query('SELECT "CasoID","__payload" FROM "CasosClientes" WHERE "__valid"=TRUE AND LOWER(COALESCE("Activo",\'true\')) <> \'false\' AND "CasoID"=ANY($1::text[])',[ids],{label:'sync.cases.changed'});
    for(const row of rows.rows){const payload=row.__payload&&typeof row.__payload==='object'?row.__payload:null;if(payload)byId.set(clean(row.CasoID),payload);}
  }
  const upserts=[]; const removed=[]; const seen=new Set();
  for(const event of events||[]){const id=clean(event?.EntityID);if(!id||seen.has(id))continue;seen.add(id);if(String(event?.Operation||'').toUpperCase()==='DELETE'){removed.push(id);continue;}const row=byId.get(id);if(!row){removed.push(id);continue;}upserts.push(customerCaseView(row));}
  const c=countsResult.rows[0]||{};
  return {upserts,removed,invalidated:[],counts:{EN_ESPERA:Number(c.espera||0),EN_PROCESO:Number(c.proceso||0),FINALIZADO:Number(c.finalizado||0),TOTAL:Number(c.total||0)}};
}
