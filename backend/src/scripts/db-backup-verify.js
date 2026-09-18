import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

function fileArg(argv){const i=argv.indexOf('--file');if(i<0||!argv[i+1])throw new Error('Use --file <backup.ndjson.gz>.');return argv[i+1];}
const file=fileArg(process.argv.slice(2));
const input=createReadStream(file).pipe(createGunzip());
const lines=createInterface({input,crlfDelay:Infinity});
let manifest=null;let current='';const declared=new Map();const actual=new Map();let lineNumber=0;
for await(const line of lines){lineNumber+=1;if(!line.trim())continue;let record;try{record=JSON.parse(line);}catch{throw new Error(`Backup inválido: JSON corrupto en línea ${lineNumber}.`);}
  if(record.kind==='manifest'){if(manifest)throw new Error('Backup inválido: manifest duplicado.');manifest=record;continue;}
  if(record.kind==='table'){current=String(record.name||'');if(!current)throw new Error('Backup inválido: tabla sin nombre.');actual.set(current,0);continue;}
  if(record.kind==='row'){if(!current||record.table!==current||!record.row||typeof record.row!=='object')throw new Error(`Backup inválido cerca de línea ${lineNumber}.`);actual.set(current,(actual.get(current)||0)+1);continue;}
  if(record.kind==='table_end'){declared.set(String(record.name||''),Number(record.rows||0));current='';continue;}
}
if(!manifest||manifest.format!=='dms-postgres-ndjson-v1')throw new Error('Backup inválido: formato no reconocido.');
const problems=[];for(const table of manifest.tables||[]){if(!actual.has(table))problems.push(`missing table ${table}`);else if((declared.get(table)??-1)!==actual.get(table))problems.push(`count mismatch ${table}`);}
console.log(JSON.stringify({ok:problems.length===0,format:manifest.format,createdAt:manifest.createdAt,tables:(manifest.tables||[]).length,rows:[...actual.values()].reduce((a,b)=>a+b,0),problems},null,2));
if(problems.length)process.exitCode=1;
