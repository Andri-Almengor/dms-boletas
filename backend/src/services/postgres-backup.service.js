import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../infra/postgres.js';

function qi(value){return `"${String(value).replace(/"/g,'""')}"`;}
async function writeLine(stream, value){if(!stream.write(`${JSON.stringify(value)}\n`))await once(stream,'drain');}

async function publicTables(){
  const result=await query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations' ORDER BY tablename",[],{label:'backup.tables'});
  const names=result.rows.map((row)=>row.tablename);
  const priority=['migration_runs','migration_sheet_rows','migration_anomalies','migration_reconciliation','sync_state'];
  return [...priority.filter((name)=>names.includes(name)),...names.filter((name)=>!priority.includes(name))];
}

export async function createPortablePostgresBackupFile({ directory = tmpdir() } = {}) {
  const id=randomUUID(); const folder=path.join(directory,`dms-pg-backup-${id}`); await mkdir(folder,{recursive:true});
  const outputPath=path.join(folder,`dms-boletas-${new Date().toISOString().replace(/[:.]/g,'-')}.ndjson.gz`);
  const file=createWriteStream(outputPath,{flags:'wx'}); const gzip=createGzip({level:6}); gzip.pipe(file);
  try{
    await withTransaction(async()=>{
      await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',[],{label:'backup.snapshot'});
      const tables=await publicTables();
      await writeLine(gzip,{kind:'manifest',format:'dms-postgres-ndjson-v1',createdAt:new Date().toISOString(),tables});
      for(const table of tables){
        let lastId=null; let offset=0; let exported=0;
        const columns=await query('SELECT column_name,is_identity FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position',[table],{label:'backup.columns'});
        const identity=columns.rows.find((row)=>row.is_identity==='YES')?.column_name||'';
        await writeLine(gzip,{kind:'table',name:table,columns:columns.rows.map((row)=>row.column_name),identity});
        while(true){
          let result;
          if(identity){
            const params=[]; let where=''; if(lastId!==null){params.push(lastId);where=`WHERE ${qi(identity)}>$1`;}
            params.push(500); result=await query(`SELECT row_to_json(t) AS row FROM (SELECT * FROM ${qi(table)} ${where} ORDER BY ${qi(identity)} ASC LIMIT $${params.length}) t`,params,{label:`backup.${table}`});
          }else{
            result=await query(`SELECT row_to_json(t) AS row FROM (SELECT * FROM ${qi(table)} OFFSET $1 LIMIT 500) t`,[offset],{label:`backup.${table}`}); offset+=result.rowCount;
          }
          if(!result.rowCount)break;
          for(const item of result.rows){await writeLine(gzip,{kind:'row',table,row:item.row});exported+=1;if(identity)lastId=item.row[identity];}
          if(result.rowCount<500)break;
        }
        await writeLine(gzip,{kind:'table_end',name:table,rows:exported});
      }
    });
    gzip.end(); await once(file,'close');
    return {outputPath,folder,stream:()=>createReadStream(outputPath)};
  }catch(error){gzip.destroy();file.destroy();await rm(folder,{recursive:true,force:true}).catch(()=>{});throw error;}
}
export async function cleanupPortableBackup(backup){if(backup?.folder)await rm(backup.folder,{recursive:true,force:true});}
