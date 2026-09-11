import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {BoundedCache,retainedBytes} from '../../backend/src/core/bounded-cache.js';
const source=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('bounded caches evict least-recent data without truncating results or retaining oversized records',()=>{
  const cache=new BoundedCache({maxBytes:500,maxEntries:2});
  const a={rows:['a']}, b={rows:['b']}, c={rows:['c']};
  cache.set('a',a).set('b',b); assert.equal(cache.get('a'),a);
  cache.set('c',c); assert.equal(cache.has('b'),false); assert.equal(cache.get('c'),c);
  const big={rows:['x'.repeat(1000)]}; cache.set('big',big);
  assert.equal(cache.has('big'),false); assert.equal(big.rows[0].length,1000);
  assert.ok(cache.bytes<=500); cache.delete('a'); cache.clear(); assert.equal(cache.bytes,0);
  const cyclic={};cyclic.self=cyclic; assert.ok(Number.isFinite(retainedBytes(cyclic)));
});

function appsFixture(){
  let stored=Buffer.alloc(0),metadata,decoded=0,moves=0;
  const response=(code,data={},headers={})=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(data),getAllHeaders:()=>headers});
  const context={CUSTOMER_CASE_EVIDENCE_MAX_BYTES:6*1024*1024,APPS_SCRIPT_VERSION:'fixture',
    clean_:(v,f='')=>String(v??'').trim()||f,safeName_:v=>v,customerCaseBoolean_:v=>Boolean(v),
    customerCaseEvidenceRootFolder_:mode=>({getId:()=>mode?'test-root':'real-root'}),
    getOrCreateFolder_:(_parent,name)=>({getId:()=>name,getUrl:()=>`folder/${name}`}),
    ScriptApp:{getOAuthToken:()=> 'owner-token'},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'owner@example.test'})},
    Utilities:{base64Decode:value=>{decoded++;return [...Buffer.from(value,'base64')];}},
    DriveApp:{getFileById:id=>({moveTo:()=>{moves++;},setName:name=>{metadata.name=name;},getId:()=>id,getName:()=>metadata.name,getUrl:()=>`file/${id}`})},
    UrlFetchApp:{fetch:(url,options)=>{
      assert.equal(options.headers.Authorization,'Bearer owner-token');
      if(url.includes('generateIds'))return response(200,{ids:['generated_file_id_123']});
      if(options.method==='post'){
        metadata=JSON.parse(options.payload); assert.equal(metadata.parents[0],'Cargas pendientes');
        return response(200,{}, {Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fixture'});
      }
      if(options.method==='get')return response(200,{...metadata,size:stored.length});
      if(options.headers['Content-Range']?.startsWith('bytes */'))return stored.length===600000?response(200):response(308,{},stored.length?{Range:`bytes=0-${stored.length-1}`}:{ });
      if(stored.length===600000)return response(404); // completed-session retry
      const range=options.headers['Content-Range'].match(/bytes (\d+)-(\d+)\/(\d+)/);
      const offset=Number(range[1]); assert.equal(offset,stored.length);
      stored=Buffer.concat([stored,Buffer.from(options.payload)]);
      return stored.length===Number(range[3])?response(200):response(308,{}, {Range:`bytes=0-${stored.length-1}`});
    }},
  };
  vm.createContext(context);new vm.Script(source('apps-script/report-service/Code.gs')); // parse full supplied script
  vm.runInContext('// Bounded upload transport.'+source('apps-script/report-service/Code.gs').split('// Bounded upload transport.')[1],context);
  return {context,get stored(){return stored;},get decoded(){return decoded;},get moves(){return moves;}};
}
test('Apps Script preserves original bytes in 256KiB blocks, recovers final retry, and restricts adoption to owner/client/mode',()=>{
  const f=appsFixture(),ctx=f.context,uploadId='a'.repeat(64),original=crypto.randomBytes(600000);
  const caseData={ClienteID:'client-1',Cliente:'Example',ModoPrueba:true,CasoID:'case-1',CasoNumero:'1'};
  const evidence={size:original.length,mimeType:'image/png',fileName:'original.png'};
  const init=ctx.initCustomerCaseResumable_({case:caseData,evidence,uploadId});
  let last;
  for(let offset=0;offset<original.length;offset+=262144){
    last={...init,uploadId,...evidence,offset,base64:original.subarray(offset,offset+262144).toString('base64')};
    const result=ctx.chunkCustomerCaseResumable_(last);
    assert.equal(result.nextOffset,Math.min(original.length,offset+262144));
    if(offset===0)assert.equal(ctx.chunkCustomerCaseResumable_(last).nextOffset,262144); // resume after lost response
  }
  assert.deepEqual(f.stored,original);assert.equal(ctx.chunkCustomerCaseResumable_(last).complete,true);
  const adopt={case:caseData,evidence:{...evidence,uploadedFileId:init.fileId,uploadId}};
  assert.throws(()=>ctx.adoptCustomerCaseResumable_({...adopt,case:{...caseData,ClienteID:'other'}}),/no pertenece/);
  assert.throws(()=>ctx.adoptCustomerCaseResumable_({...adopt,case:{...caseData,ModoPrueba:false}}),/no pertenece/);
  const result=ctx.adoptCustomerCaseResumable_(adopt);assert.equal(result.ownerEmail,'owner@example.test');assert.equal(f.moves,1);
  const decoded=f.decoded;
  assert.throws(()=>ctx.chunkCustomerCaseResumable_({...last,base64:'a'.repeat(400000)}),/Bloque/);
  assert.equal(f.decoded,decoded);
});

test('signed case receipt rejects another client, request, mode, or tampering',async()=>{
  const tokenCode=source('backend/src/services/large-evidence-upload.service.js').split('async function accessToken()')[0].replace(/^import .*;\n/gm,'');
  const service=source('backend/src/services/customer-case-apps-script-drive.service.js').replace(/^import .*;\n/gm,'');
  const ctx={crypto,Buffer,Date,AppError:Error,badRequest:message=>new Error(message),env:{googlePrivateKey:'fixture-private-key'}};
  vm.createContext(ctx);vm.runInContext(tokenCode.replace(/export /g,'')+'\n'+service.slice(service.indexOf('function caseUploadScope')).replace(/export /g,''),ctx);
  const portal={client:{ClienteID:'one'},testMode:true},requestId='request-123';
  const receipt=ctx.createUploadToken({kind:'case-receipt',clientId:'one',testMode:true,requestId,fileId:'file-id',size:12,mimeType:'image/png'});
  assert.equal(ctx.resolveCustomerCaseUpload(receipt,portal,requestId).bytes,12);
  assert.throws(()=>ctx.resolveCustomerCaseUpload(receipt,{...portal,testMode:false},requestId));
  assert.throws(()=>ctx.resolveCustomerCaseUpload(receipt,{...portal,client:{ClienteID:'two'}},requestId));
  assert.throws(()=>ctx.resolveCustomerCaseUpload(receipt,portal,'different'));
  assert.throws(()=>ctx.resolveCustomerCaseUpload(receipt.slice(0,-5)+'xxxxx',portal,requestId));
});

test('email skips downloading a 300MB video and preserves attachment bytes for a small image',async()=>{
  let sent;const downloads=[];const image=Buffer.from('original image bytes');
  const context={env:{smtpHost:'fixture',smtpUser:'fixture',smtpPass:'fixture'},process:{env:{}},console,
    nodemailer:{createTransport:()=>({sendMail:async payload=>{sent=payload;return {messageId:'fixture',accepted:['person@example.test']};}})},
    AppError:Error,escapeHtml:v=>String(v??''),extractDriveFileId:id=>id,
    getDriveFile:async id=>({size:id==='large'?300*1024*1024:image.length}),
    downloadFileBuffer:async id=>{downloads.push(id);return {name:'original.png',mimeType:'image/png',buffer:image};},
  };
  vm.createContext(context);vm.runInContext(source('backend/src/services/email.service.js').replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
  await context.sendTicketReportEmail({to:['person@example.test'],report:{ticket:{BoletaUID:'fixture'},pdfName:'report.pdf',pdfBuffer:Buffer.from('pdf'),assigned:[],evidences:[{ArchivoID:'large',ArchivoURL:'https://drive.test/large'},{ArchivoID:'small'}]}});
  assert.deepEqual(downloads,['small']);assert.equal(sent.attachments.length,2);assert.equal(sent.attachments[1].content,image);assert.match(sent.html,/https:\/\/drive.test\/large/);
});
