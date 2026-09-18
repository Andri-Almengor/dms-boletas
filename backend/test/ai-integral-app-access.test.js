import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AI_INTENTS,
  classifyAiIntent,
  toolNamesForEntityTypes,
  toolNamesForIntent,
} from '../src/ai/agent.intent.js';
import { declarationsForUser } from '../src/ai/agent.tools.js';
import { runDmsAgent, _resetAiRateLimitForTests } from '../src/ai/agent.service.js';

const source=(relative)=>readFileSync(new URL(relative,import.meta.url),'utf8');

test('Operational questions override stale Knowledge context',()=>{
  const knowledgeContext={
    lastKnowledgeArticleId:'ARTICLE-AXIS',
    lastKnowledgeDocumentId:'DOC-AXIS',
    lastKnowledgeDocumentName:'Guia Axis.pdf',
  };
  assert.equal(
    classifyAiIntent({
      message:'Dame la fecha de creación de los dispositivos del Proyecto Zeus y sus imágenes',
      context:knowledgeContext,
    }),
    AI_INTENTS.MAINTENANCE_EVIDENCE,
  );
  assert.equal(
    classifyAiIntent({
      message:'Dame las imágenes de la boleta 1542',
      context:knowledgeContext,
    }),
    AI_INTENTS.TICKET_EVIDENCE,
  );
  assert.equal(
    classifyAiIntent({
      message:'¿qué dice sobre PoE?',
      context:knowledgeContext,
    }),
    AI_INTENTS.KNOWLEDGE_DOCUMENTS,
  );
});

test('General and ambiguous turns keep secure internal discovery and attachment tools',()=>{
  for(const intent of [AI_INTENTS.GENERAL,AI_INTENTS.AMBIGUOUS,AI_INTENTS.WEB]){
    const names=toolNamesForIntent(intent);
    assert.equal(names.includes('search_internal'),true);
    assert.equal(names.includes('read_chat_attachment'),true);
  }
  const discovered=toolNamesForEntityTypes(['maintenance','device']);
  for(const name of ['resolve_maintenance_reference','get_maintenance','get_maintenance_devices','get_maintenance_evidence','search_maintenance_evidence']){
    assert.equal(discovered.includes(name),true,name);
  }
});

test('Authenticated users can receive secure chat attachment reader without Drive access',()=>{
  const tools=declarationsForUser(
    {user:{UsuarioID:'USER-1'},permissions:['BOLETAS_VER']},
    {selectedNames:['read_chat_attachment']},
  );
  assert.equal(tools.some((item)=>item.type==='function'&&item.name==='read_chat_attachment'),true);
  const declaration=tools.find((item)=>item.name==='read_chat_attachment');
  assert.deepEqual(declaration.parameters.required,['uploadId']);
  assert.equal(Object.prototype.hasOwnProperty.call(declaration.parameters.properties,'DriveFileID'),false);
  assert.equal(Object.keys(declaration.parameters.properties).some((key)=>key.toLowerCase()==='drivefileid'),false);
});

test('Unknown internal entity can expand toolset from search_internal to maintenance tools in one turn',async()=>{
  _resetAiRateLimitForTests();
  let modelCall=0;
  const executed=[];
  const fakeModel=async({tools})=>{
    modelCall+=1;
    const names=tools.filter((item)=>item.type==='function').map((item)=>item.name);
    if(modelCall===1){
      assert.equal(names.includes('search_internal'),true);
      assert.equal(names.includes('get_maintenance_devices'),false);
      return {steps:[{type:'function_call',id:'d1',name:'search_internal',arguments:{query:'Zeus'}}]};
    }
    if(modelCall===2){
      assert.equal(names.includes('get_maintenance'),true);
      assert.equal(names.includes('get_maintenance_devices'),true);
      assert.equal(names.includes('get_maintenance_evidence'),true);
      return {steps:[{type:'function_call',id:'d2',name:'get_maintenance_devices',arguments:{maintenanceId:'maintenance-zeus',limit:50}}]};
    }
    return {steps:[{type:'model_output',content:[{type:'text',text:'El Proyecto Zeus tiene 2 dispositivos; se muestran sus fechas registradas.'}]}]};
  };
  const emptyUi={entities:[],attachments:[],sources:[],confirmations:[],context:{}};
  const fakeTool=async(_ctx,name,args)=>{
    executed.push([name,args]);
    if(name==='search_internal') return {
      tool:name,
      modelData:{query:'Zeus',matches:[{type:'maintenance',id:'maintenance-zeus',title:'Proyecto Zeus'}]},
      ui:{...emptyUi,context:{lastMaintenanceId:'maintenance-zeus',lastMaintenanceName:'Proyecto Zeus'}},
    };
    if(name==='get_maintenance_devices') return {
      tool:name,
      modelData:{
        maintenance:{id:'maintenance-zeus',title:'Proyecto Zeus',client:'Cliente Demo'},
        total:2,totalShown:2,
        items:[
          {id:'D1',name:'Cámara 1',zone:'Acceso',createdAt:'2026-09-01T10:00:00Z',evidenceCount:3},
          {id:'D2',name:'Cámara 2',zone:'Lobby',createdAt:'2026-09-02T10:00:00Z',evidenceCount:4},
        ],
      },
      ui:{...emptyUi,context:{lastMaintenanceId:'maintenance-zeus',lastMaintenanceName:'Proyecto Zeus'}},
    };
    throw new Error('Unexpected tool '+name);
  };

  const response=await runDmsAgent({
    requestId:'REQ-ZEUS-DISCOVERY',
    sessionToken:'TEST-SESSION',
    user:{UsuarioID:'USER-1',NombreCompleto:'Usuario'},
    permissions:['BOLETAS_VER'],
    payload:{message:'Dame los dispositivos de Zeus',conversationId:'C-ZEUS',history:[],context:{},attachmentIds:[]},
  },{models:['test-model'],createInteraction:fakeModel,executeAiTool:fakeTool,audit:async()=>{}});

  assert.deepEqual(executed.map(([name])=>name),['search_internal','get_maintenance_devices']);
  assert.match(response.answer,/Proyecto Zeus/i);
  assert.equal(response.context.lastMaintenanceId,'maintenance-zeus');
});

test('Maintenance repositories expose device creation dates and evidence aggregates',()=>{
  const maintenance=source('../src/ai/agent.repository.maintenance.js');
  const integral=source('../src/ai/agent.repository.maintenance.integral.js');
  assert.match(maintenance,/d\."FechaCreacion" AS "createdAt"/);
  assert.match(maintenance,/evidenceCount:Number\(evidenceSummary\?\.total\|\|0\)/);
  assert.match(maintenance,/imageCount:Number\(evidenceSummary\?\.images\|\|0\)/);
  assert.match(maintenance,/beforeEvidenceCount/);
  assert.match(maintenance,/afterEvidenceCount/);
  assert.match(integral,/mimeCategory/);
  assert.match(integral,/uploaderName/);
  assert.match(integral,/addRange\(clauses,params,'mi\."FechaCreacion"',args\)/);
  assert.match(integral,/imageCount: Number\(counted\?\.images\|\|0\)/);
});

test('Credential questions are routed through Password Vault before Gemini',()=>{
  const agenda=source('../src/modules/assistant-agenda.module.js');
  const vaultPatch=source('../src/services/password-vault-assistant.patch.js');
  assert.match(agenda,/isPasswordVaultAssistantQuestion\(question\)/);
  assert.match(agenda,/answerPasswordVaultAssistantQuestion\(ctx, question\)/);
  assert.match(vaultPatch,/export async function answerPasswordVaultAssistantQuestion/);
  assert.match(vaultPatch,/queryPasswordVaultForAssistant/);
  assert.match(vaultPatch,/sensitive: rows\.length > 0/);
});

test('Integral prompt forbids Knowledge lock-in and explains discovery, attachments and web',()=>{
  const prompt=source('../src/ai/agent.prompt.js');
  assert.match(prompt,/contexto anterior nunca limita las capacidades/i);
  assert.match(prompt,/Nunca digas que tus herramientas están limitadas a Knowledge/i);
  assert.match(prompt,/usa search_internal/i);
  assert.match(prompt,/read_chat_attachment/i);
  assert.match(prompt,/Password Vault/i);
  assert.match(prompt,/buscar en Google, internet o web/i);
});

test('Web search is enabled by default but remains configurable',()=>{
  const config=source('../src/ai/agent.config.js');
  const envExample=source('../.env.example');
  assert.match(config,/AI_WEB_SEARCH_ENABLED', true/);
  assert.match(envExample,/AI_WEB_SEARCH_ENABLED=true/);
});
