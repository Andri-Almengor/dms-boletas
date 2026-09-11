import http from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import assert from 'node:assert/strict';

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'fixture@example.invalid';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'fixture-not-a-key';
process.env.HEALTH_DETAILS_PUBLIC = 'false';
process.env.HTTP_QUEUE_LIMIT = '50';
const { concurrencyMiddleware, concurrencySnapshot } = await import('../backend/src/middleware/concurrency.middleware.js');
const { runWithActionConcurrency, actionConcurrencySnapshot } = await import('../backend/src/services/action-concurrency.service.js');
const { env } = await import('../backend/src/config/env.js');
const { resolveRequestId } = await import('../backend/src/core/request-security.js');
// Execute the production handler and health implementation with ONLY the
// downstream app replaced. No Google/SMTP/Drive clients are imported or called.
const code = readFileSync(new URL('../backend/src/server.js', import.meta.url), 'utf8');
const sendHealth = new Function('env', 'resolveRequestId', 'bootId', `return ${code.slice(code.indexOf('function sendHealth'), code.indexOf('\nfunction requestHandler'))}`)(env, resolveRequestId, 'stress-fixture');
let activeUploads = 0, peakUploads = 0, parsedBodies = 0;
const fixtureApp = async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  parsedBodies++;
  const body = JSON.parse(Buffer.concat(chunks).toString());
  try {
    const result = await runWithActionConcurrency(body.route, async () => {
      const upload = Boolean(body.payload?.base64);
      if (upload) peakUploads = Math.max(peakUploads, ++activeUploads);
      if (upload) assert.equal(Buffer.from(body.payload.base64, 'base64').length, body.payload.bytes);
      await new Promise(resolve => setTimeout(resolve, upload ? 100 : 20));
      if (upload) activeUploads--;
      return {fixture: true};
    });
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(result));
  } catch (error) { res.statusCode = error.status || 500; res.end('{}'); }
};
const handler = new Function('sendHealth','concurrencyMiddleware','app','resolveRequestId',`return ${code.slice(code.indexOf('function requestHandler'),code.indexOf('\nconst server ='))}`)(sendHealth,concurrencyMiddleware,fixtureApp,resolveRequestId);
const server = http.createServer(handler);
server.listen(0,'127.0.0.1'); await once(server,'listening');
const endpoint = `http://127.0.0.1:${server.address().port}`;
const histogram = monitorEventLoopDelay({resolution:10}); histogram.enable();
const latencies=[]; const snapshots=[];
const sample = setInterval(()=>snapshots.push({memory:process.memoryUsage(),http:concurrencySnapshot(),actions:actionConcurrencySnapshot()}),20);
try {
  const request = (route,payload={}) => fetch(endpoint+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({route,payload})}).then(async response=>{await response.text(); assert.equal(response.status,200);});
  const health = (async()=>{ for(let i=0;i<40;i++) {const start=performance.now(); const response=await fetch(endpoint+'/api/health'); const body=await response.json(); assert.equal(response.status,200); assert.equal(body.ok,true); assert.equal(body.memory,undefined); latencies.push(performance.now()-start); await new Promise(r=>setTimeout(r,10));} })();
  const bytes=2*1024*1024;
  await Promise.all([health,...Array.from({length:20},()=>request('clients.list')),...Array.from({length:3},()=>request('auth.me')),...Array.from({length:3},()=>request('auth.login')),request('boletas.evidence.upload',{base64:Buffer.alloc(bytes,7).toString('base64'),bytes}),request('maintenance.images.upload',{base64:Buffer.alloc(bytes,8).toString('base64'),bytes})]);
  assert.equal(peakUploads,1);
  assert.equal(parsedBodies,28);
  assert.equal(concurrencySnapshot().requests.active,0);
  assert.ok(Math.max(...latencies)<2000,'health should stay available');
  console.log(JSON.stringify({requests:parsedBodies,healthRequests:latencies.length,healthMaxMs:Math.round(Math.max(...latencies)),healthMeanMs:Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length),eventLoopP99Ms:Math.round(histogram.percentile(99)/1e6),peakUploads,peakMemory:Object.fromEntries(['rss','heapUsed','external','arrayBuffers'].map(key=>[key,Math.max(...snapshots.map(s=>s.memory[key]))])),peakQueued:Math.max(...snapshots.map(s=>s.http.requests.waiting)),final:concurrencySnapshot()},null,2));
} finally {clearInterval(sample); histogram.disable(); server.closeAllConnections(); await new Promise(r=>server.close(r));}
