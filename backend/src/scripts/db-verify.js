import { analyzeWorkbook, publicAnalysis, rowChecksum } from './xlsx-migration.js';
import { DATABASE_TABLES } from '../config/database-tables.js';
import { scriptPool, quoted } from './db-script.js';

function fileArg(argv){const index=argv.indexOf('--file');if(index<0||!argv[index+1])throw new Error('Use --file <ruta.xlsx>.');return argv[index+1];}
const file=fileArg(process.argv.slice(2));const analysis=await analyzeWorkbook(file);const expected=publicAnalysis(analysis);const pool=scriptPool();
let ok=true;const problems=[];
try{
  const runResult=await pool.query("SELECT migration_run_id FROM migration_runs WHERE source_sha256=$1 AND status='APPLIED' ORDER BY completed_at DESC LIMIT 1",[analysis.file.sha256]);
  const runId=runResult.rows[0]?.migration_run_id;if(!runId)throw new Error('No existe una importación APPLIED para este XLSX.');
  const raw=await pool.query('SELECT sheet_name,source_row_number,row_data,row_checksum FROM migration_sheet_rows WHERE migration_run_id=$1',[runId]);
  const expectedByKey=new Map();for(const [name,sheet] of analysis.sheets)for(const row of sheet.rows)expectedByKey.set(`${name}:${row.sourceRowNumber}`,row);
  for(const dbRow of raw.rows){const key=`${dbRow.sheet_name}:${dbRow.source_row_number}`;const source=expectedByKey.get(key);if(!source){ok=false;problems.push(`unexpected raw row ${key}`);continue;}const headers=analysis.sheets.get(dbRow.sheet_name)?.headers||[];const actualChecksum=rowChecksum(dbRow.row_data||{},headers);if(dbRow.row_checksum!==source.checksum||actualChecksum!==source.checksum){ok=false;problems.push(`raw checksum mismatch ${key}`);}}
  if(raw.rowCount!==analysis.workbook.sourceRows){ok=false;problems.push(`raw count ${raw.rowCount} != ${analysis.workbook.sourceRows}`);}
  let canonicalRows=0;let validCanonicalRows=0;
  for(const [name,sheet] of analysis.sheets){if(!DATABASE_TABLES[name])continue;const result=await pool.query(`SELECT "__source_row_number","__row_checksum","__payload","__valid" FROM ${quoted(name)} WHERE "__migration_run_id"=$1 ORDER BY "__source_row_number"`,[runId]);canonicalRows+=result.rowCount;validCanonicalRows+=result.rows.filter(r=>r.__valid).length;for(const dbRow of result.rows){const source=expectedByKey.get(`${name}:${dbRow.__source_row_number}`);if(!source){ok=false;problems.push(`unexpected canonical row ${name}:${dbRow.__source_row_number}`);continue;}const canonicalHeaders=name==='SyncChanges'?sheet.headers.filter((header)=>header!=='Cursor'):sheet.headers;const checksum=rowChecksum(dbRow.__payload||{},canonicalHeaders);const sourceCanonicalChecksum=rowChecksum(source.data||{},canonicalHeaders);if(dbRow.__row_checksum!==source.checksum||checksum!==sourceCanonicalChecksum){ok=false;problems.push(`canonical checksum mismatch ${name}:${dbRow.__source_row_number}`);}}}
  if(canonicalRows!==expected.canonicalRows){ok=false;problems.push(`canonical count ${canonicalRows} != ${expected.canonicalRows}`);}if(validCanonicalRows!==expected.validCanonicalRows){ok=false;problems.push(`valid canonical count ${validCanonicalRows} != ${expected.validCanonicalRows}`);}
  const recon=await pool.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(raw_rows),0)::bigint AS raw,COALESCE(SUM(canonical_rows),0)::bigint AS canonical FROM migration_reconciliation WHERE migration_run_id=$1',[runId]);
  if(Number(recon.rows[0]?.count)!==analysis.workbook.sheetCount||Number(recon.rows[0]?.raw)!==analysis.workbook.sourceRows){ok=false;problems.push('reconciliation totals mismatch');}
  console.log(JSON.stringify({ok,runId,sourceSha256:analysis.file.sha256,sheets:analysis.workbook.sheetCount,sourceRows:analysis.workbook.sourceRows,rawRows:raw.rowCount,canonicalRows,validCanonicalRows,allSourceChecksumsMatch:problems.every(x=>!x.includes('checksum mismatch')),sensitiveValuesPreservedByCanonicalChecksum:ok,driveMetadataPreservedByCanonicalChecksum:ok,relationshipSourceRowsPreservedByRawChecksum:ok,problems:problems.slice(0,50)},null,2));
  if(!ok)process.exitCode=1;
}finally{await pool.end();}
