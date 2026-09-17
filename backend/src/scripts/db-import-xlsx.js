import { analyzeWorkbook, publicAnalysis } from './xlsx-migration.js';
import { DATABASE_TABLES } from '../config/database-tables.js';
import { scriptPool, quoted } from './db-script.js';

function args(argv) {
  const out={dryRun:false,apply:false,replace:false,file:''};
  for(let i=0;i<argv.length;i+=1){const value=argv[i]; if(value==='--dry-run')out.dryRun=true; else if(value==='--apply')out.apply=true; else if(value==='--replace')out.replace=true; else if(value==='--file')out.file=argv[++i]||'';}
  if(!out.file) throw new Error('Use --file <ruta.xlsx>.');
  if(out.dryRun===out.apply) throw new Error('Indique exactamente uno: --dry-run o --apply.');
  return out;
}
function text(value){ if(value===undefined||value===null)return ''; if(typeof value==='object')return JSON.stringify(value); return String(value); }
function chunks(items,size){const out=[]; for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size)); return out;}

async function insertRaw(client, runId, sheetName, rows){
  for(const batch of chunks(rows,300)){
    const params=[]; const values=[];
    for(const row of batch){params.push(runId,sheetName,row.sourceRowNumber,JSON.stringify(row.data),row.checksum); const o=params.length-4; values.push(`($${o},$${o+1},$${o+2},$${o+3}::jsonb,$${o+4})`);}
    await client.query(`INSERT INTO migration_sheet_rows(migration_run_id,sheet_name,source_row_number,row_data,row_checksum) VALUES ${values.join(',')}`,params);
  }
}
async function insertCanonical(client, runId, name, sheet, malformedRows){
  const meta=DATABASE_TABLES[name]; if(!meta)return;
  const columns=meta.columns.filter((column)=>!(name==='SyncChanges'&&column==='Cursor'));
  const perRow=columns.length+5; const batchSize=Math.max(1,Math.min(150,Math.floor(50000/perRow)));
  for(const batch of chunks(sheet.rows,batchSize)){
    const params=[]; const values=[];
    for(const row of batch){
      const payload=Object.fromEntries(columns.map((column)=>[column,row.data[column]??'']));
      const valid=!malformedRows.has(row.sourceRowNumber);
      for(const column of columns)params.push(text(row.data[column]??''));
      params.push(JSON.stringify(payload),runId,row.sourceRowNumber,row.checksum,valid);
      const start=params.length-perRow+1;
      values.push(`(${Array.from({length:perRow},(_,index)=>`$${start+index}${index===columns.length?'::jsonb':''}`).join(',')})`);
    }
    const allColumns=[...columns.map(quoted),'"__payload"','"__migration_run_id"','"__source_row_number"','"__row_checksum"','"__valid"'];
    await client.query(`INSERT INTO ${quoted(name)} (${allColumns.join(',')}) VALUES ${values.join(',')}`,params);
  }
}

const options=args(process.argv.slice(2));
const analysis=await analyzeWorkbook(options.file);
const report=publicAnalysis(analysis);
console.log(JSON.stringify(report,null,2));
if(options.dryRun) process.exit(0);

const pool=scriptPool();
const client=await pool.connect();
try{
  const previous=await client.query("SELECT migration_run_id FROM migration_runs WHERE source_sha256=$1 AND status='APPLIED' ORDER BY completed_at DESC LIMIT 1",[analysis.file.sha256]);
  if(previous.rows[0]){console.log(`Workbook already applied: run=${previous.rows[0].migration_run_id}`); process.exitCode=0;}
  else {
    const nonEmpty=await client.query(`SELECT EXISTS(${Object.keys(DATABASE_TABLES).map((name)=>`SELECT 1 FROM ${quoted(name)} LIMIT 1`).join(' UNION ALL ')}) AS present`);
    if(nonEmpty.rows[0]?.present&&!options.replace) throw new Error('La base operativa no está vacía. Use --replace únicamente durante un cutover controlado.');
    await client.query('BEGIN');
    if(options.replace){
      await client.query(`TRUNCATE TABLE ${Object.keys(DATABASE_TABLES).map(quoted).join(', ')} RESTART IDENTITY`);
      await client.query('TRUNCATE TABLE runtime_sequences');
    }
    await client.query('INSERT INTO migration_runs(migration_run_id,source_file_name,source_sha256,source_size_bytes,source_sheet_count,source_row_count,status) VALUES($1,$2,$3,$4,$5,$6,\'RUNNING\')',[analysis.runId,analysis.file.name,analysis.file.sha256,analysis.file.size,analysis.workbook.sheetCount,analysis.workbook.sourceRows]);
    for(const [name,sheet] of analysis.sheets){
      await insertRaw(client,analysis.runId,name,sheet.rows);
      if(DATABASE_TABLES[name]){
        const malformedRows=new Set(analysis.anomalies.filter((item)=>item.sheet===name&&item.type==='MALFORMED_ROW').map((item)=>item.row));
        await insertCanonical(client,analysis.runId,name,sheet,malformedRows);
      }
    }
    for(const anomaly of analysis.anomalies){
      await client.query('INSERT INTO migration_anomalies(migration_run_id,sheet_name,source_row_number,anomaly_type,column_name,reference_table,detail) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[analysis.runId,anomaly.sheet,anomaly.row,anomaly.type,anomaly.column||'',anomaly.referenceTable||'',JSON.stringify(anomaly.detail||{})]);
    }
    for(const [name,row] of Object.entries(analysis.reconciliation)){
      await client.query('INSERT INTO migration_reconciliation(migration_run_id,sheet_name,source_rows,raw_rows,canonical_rows,valid_canonical_rows,duplicates,malformed,orphans,checksum,status,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',[analysis.runId,name,row.sourceRows,row.rawRows,row.canonicalRows,row.validCanonicalRows,row.duplicates,row.malformed,row.orphans,row.checksum,row.status,JSON.stringify({legacy:!DATABASE_TABLES[name]})]);
    }
    const legacyCursor=String(analysis.sheets.get('SyncChanges')?.rows.find((row)=>row.data.Cursor!==''&&row.data.Cursor!==undefined)?.data.Cursor??'');
    await client.query('INSERT INTO sync_state(singleton,generation,schema_version,legacy_sheets_cursor,migration_run_id,updated_at) VALUES(TRUE,$1,2,$2,$3,NOW()) ON CONFLICT(singleton) DO UPDATE SET generation=EXCLUDED.generation,schema_version=EXCLUDED.schema_version,legacy_sheets_cursor=EXCLUDED.legacy_sheets_cursor,migration_run_id=EXCLUDED.migration_run_id,updated_at=NOW()',[analysis.runId,legacyCursor,analysis.runId]);
    await client.query("UPDATE migration_runs SET status='APPLIED',completed_at=NOW(),report=$2::jsonb WHERE migration_run_id=$1",[analysis.runId,JSON.stringify(report)]);
    await client.query('COMMIT');
    console.log(`Applied migration run ${analysis.runId}`);
  }
}catch(error){await client.query('ROLLBACK').catch(()=>{}); throw error;} finally {client.release(); await pool.end();}
