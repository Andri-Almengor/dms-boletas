import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A cold module sees the persisted, UNFORMATTED_VALUE/SERIAL_NUMBER result,
// not the repository's optimistic write-through cache.
function sheetsUserEntered(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return (Date.parse(value) - Date.UTC(1899, 11, 30)) / 86400000;
  }
  return value;
}
async function coldBackup(state) {
  globalThis.__backupFixture = state;
  let code = readFileSync(new URL('../../backend/src/services/weekly-backup.service.js', import.meta.url), 'utf8');
  code = code.replace(/import[\s\S]*?from ['"][^'"]+['"];\n/g, '');
  code = `const {env, readTable, appendRows, updateRows, copyDriveFile, createFolder, getDriveFile} = globalThis.__backupFixture;\n${code}\nexport { schedulerTick };`;
  return import(`data:text/javascript;base64,${Buffer.from(code + '\n//' + Math.random()).toString('base64')}`);
}
function fixture() {
  const values = { BACKUP_WEEKLY_ENABLED: 'true', BACKUP_FOLDER_ID: 'folder', BACKUP_LAST_STATUS: 'SIN_RESPALDO' };
  const state = {
    values, copies: 0, env: {sheetId: 'fixture'},
    readTable: async () => Object.entries(values).map(([Clave,Valor])=>({Clave,Valor})),
    appendRows: async (_table, rows) => rows.forEach(row => {values[row.Clave] = sheetsUserEntered(row.Valor);}),
    updateRows: async (_table, rows) => rows.forEach(row => {values[row.idValue] = sheetsUserEntered(row.patch.Valor);}),
    getDriveFile: async () => ({id:'folder', mimeType:'application/vnd.google-apps.folder'}),
    createFolder: async () => ({id:'folder'}),
    copyDriveFile: async ({name}) => ({id:`copy-${++state.copies}`,name}),
  };
  return state;
}
test('USER_ENTERED date reproduces the serial returned for Configuracion.Valor', () => {
  assert.equal(sheetsUserEntered('2026-09-06'), 46271);
  assert.equal(sheetsUserEntered('WEEK_SLOT:2026-09-06'), 'WEEK_SLOT:2026-09-06');
});
test('20 cold starts create at most one automatic weekly backup; manual still works', async () => {
  const state = fixture();
  for (let i=0;i<20;i++) await (await coldBackup(state)).schedulerTick();
  assert.equal(state.copies,1);
  assert.match(String(state.values.BACKUP_LAST_SLOT), /^WEEK_SLOT:/);
  await (await coldBackup(state)).createWeeklyBackup({actor:'manual-fixture'});
  assert.equal(state.copies,2);
});

import { withRequestDeadline, requestTimeoutMs } from '../../src/services/requestPolicy.js';
import { isAuthenticationError } from '../../src/services/requestErrors.js';
import { claimAutomaticReload } from '../../src/services/reloadRecovery.js';
import { AsyncSemaphore } from '../../backend/src/core/semaphore.js';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('login deadline aborts a hung transport and settles even if fetch ignores abort', async () => {
  let signal;
  await assert.rejects(withRequestDeadline('auth.login',undefined,s=>{signal=s;return new Promise(()=>{});},15), {code:'REQUEST_TIMEOUT'});
  assert.equal(signal.aborted,true);
  assert.ok(requestTimeoutMs('auth.login')<requestTimeoutMs('maintenance.finalize'));
});
test('deadline covers response-body reads and preserves user cancellation', async () => {
  await assert.rejects(withRequestDeadline('auth.me',undefined,async()=>{await Promise.resolve();return new Promise(()=>{});},15),{code:'REQUEST_TIMEOUT'});
  const controller=new AbortController(); const reason=new Error('user cancelled');
  const result=withRequestDeadline('auth.me',controller.signal,()=>new Promise(()=>{}),1000);
  controller.abort(reason); await assert.rejects(result,error=>error===reason);
});
test('only actual unauthorized invalidates cached credentials', () => {
  for(const error of [new TypeError('Failed to fetch'), {code:'REQUEST_TIMEOUT'}, ...[502,503,504].map(status=>({status,code:'UNAUTHORIZED'}))]) assert.equal(isAuthenticationError(error),false);
  assert.equal(isAuthenticationError({status:401}),true);
  assert.equal(isAuthenticationError({code:'UNAUTHORIZED'}),true);
});
test('reload is shared and allowed once; storage failure disables automatic reload', () => {
  const data=new Map(); const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  assert.equal(claimAutomaticReload(storage),true);
  for(let i=0;i<20;i++) assert.equal(claimAutomaticReload(storage),false);
  assert.equal(claimAutomaticReload({getItem(){throw new Error('restricted');}}),false);
});
test('abandoned queued requests release queue capacity immediately', async () => {
  const gate=new AsyncSemaphore({max:1,queueLimit:1});const release=await gate.acquire();
  const controller=new AbortController();const queued=gate.acquire({signal:controller.signal});
  controller.abort();await assert.rejects(queued);assert.equal(gate.snapshot().waiting,0);release();
});
test('unknown-length and compressed requests wait before downstream body parsing', async () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL='fixture@example.invalid';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY='fixture-not-a-key';
  const { concurrencyMiddleware,concurrencySnapshot }=await import('../../backend/src/middleware/concurrency.middleware.js');
  const active=new EventEmitter();let parsed=0;
  await concurrencyMiddleware({method:'POST',url:'/api/action',headers:{'content-length':'2000000'}},active,()=>{parsed++;});
  const queuedRes=new EventEmitter();const queued=concurrencyMiddleware({method:'POST',url:'/api/action',headers:{'transfer-encoding':'chunked'}},queuedRes,()=>{parsed++;});
  await new Promise(r=>setImmediate(r));assert.equal(parsed,1);assert.equal(concurrencySnapshot().largeRequests.waiting,1);
  active.emit('finish');await queued;assert.equal(parsed,2);queuedRes.emit('finish');
  assert.equal(concurrencySnapshot().requests.active,0);
});
test('real health handler stays independent of external services under mixed load', async () => {
  const {stdout}=await promisify(execFile)(process.execPath,['scripts/stress-stability.mjs'],{cwd:new URL('../../',import.meta.url),timeout:15000});
  const result=JSON.parse(stdout);assert.equal(result.healthRequests,40);assert.equal(result.peakUploads,1);
});
test('failed/ambiguous backup never automatically copies again after a cold start', async () => {
  const state=fixture();state.copyDriveFile=async()=>{state.copies++;throw new Error('connection lost after remote copy');};
  await (await coldBackup(state)).schedulerTick();
  await (await coldBackup(state)).schedulerTick();
  assert.equal(state.copies,1);
});

import { transform } from 'esbuild';
test('AuthProvider retains cached session on network failure and clears it on 401', async () => {
  for (const error of [new TypeError('Failed to fetch'), {status:503}, {status:401}]) {
    const cached={sessionToken:'fixture-token',user:{UsuarioID:'fixture-user'},permissions:['BOLETAS_VER']};
    const storage=new Map([['dms_session',JSON.stringify(cached)]]);
    const state=[];let cursor=0;let effects=[];let captured;
    const React={createElement:(_type,props)=>{captured=props.value;return null;}};
    const fixture={React,createContext:()=>({Provider:'provider'}),useContext:()=>null,
      useMemo:fn=>fn(),useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],value=>{state[index]=value;}];},useEffect:fn=>effects.push(fn),
      localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
      apiRequest:async()=>{throw error;},isAuthenticationError,hasImpliedOperationalClientPermission:()=>false};
    globalThis.__authFixture=fixture;
    let source=readFileSync(new URL('../../src/context/AuthContext.jsx',import.meta.url),'utf8').replace(/import[^;]+;\n/g,'');
    source='const {'+Object.keys(fixture).join(',')+'}=globalThis.__authFixture;\n'+source;
    const {code}=await transform(source,{loader:'jsx',format:'esm'});
    const module=await import('data:text/javascript;base64,'+Buffer.from(code+'\n//'+Math.random()).toString('base64'));
    module.AuthProvider({children:null});effects[0]();await new Promise(r=>setImmediate(r));
    cursor=0;effects=[];module.AuthProvider({children:null});
    if(error.status===401){assert.equal(captured.user,null);assert.equal(storage.has('dms_session'),false);}
    else {assert.deepEqual(captured.user,cached.user);assert.equal(captured.sessionToken,cached.sessionToken);assert.deepEqual(captured.permissions,cached.permissions);assert.equal(storage.has('dms_session'),true);}
    assert.equal(captured.loading,false);
  }
});

test('reusable evidence transport preserves every byte and bounds each block', async () => {
  const original=Buffer.alloc(2*1024*1024+19);for(let i=0;i<original.length;i++)original[i]=i%251;
  const blocks=[];
  globalThis.__uploadFixture={fileToBase64:async blob=>Buffer.from(await blob.arrayBuffer()).toString('base64'),requestAvailable:async (_routes,payload)=>{
    if(!('offset' in payload))return {uploadToken:'fixture',chunkBytes:256*1024};
    const chunk=Buffer.from(payload.base64,'base64');assert.ok(chunk.length<=256*1024);blocks.push(chunk);
    return {complete:payload.offset+chunk.length===original.length,nextOffset:payload.offset+chunk.length,evidence:{id:'fixture'}};
  }};
  let code=readFileSync(new URL('../../src/services/largeEvidenceUpload.js',import.meta.url),'utf8').replace(/import[^;]+;\n/g,'');
  code='const {fileToBase64,requestAvailable}=globalThis.__uploadFixture;\n'+code;
  const module=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  for(const mimeType of ['image/png','application/pdf','video/mp4']) {
    blocks.length=0;const file=new Blob([original],{type:mimeType});file.name='fixture';
    assert.equal(module.shouldUseLargeEvidenceUpload({file}),true);
    await module.uploadLargeTicketEvidence({boletaUid:'fixture',evidenceId:'fixture-id',item:{file,mimeType},sessionToken:'fixture'});
    assert.deepEqual(Buffer.concat(blocks),original);
  }
});
