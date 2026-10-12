import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_INTENTS, classifyAiIntent, isTechnicalKnowledgeQuery, toolNamesForIntent } from '../src/ai/agent.intent.js';
import { aiAccess, appendKnowledgeVisibility } from '../src/ai/agent.permissions.js';
import { declarationsForUser } from '../src/ai/agent.tools.js';

const KNOWLEDGE_TOOLS = [
  'search_knowledge_base',
  'get_knowledge_article',
  'search_knowledge_documents',
  'get_knowledge_document',
  'search_knowledge_document_chunks',
];

test('consulta técnica sin fabricante activa Knowledge en vez de GENERAL', () => {
  const questions = [
    'como restablezco la contraseña del License Administrator',
    '¿Cómo puedo cambiar la contraseña del License Administrator?',
    '¿Tienes la guía para License Administrator?',
    'Necesito recuperar la contraseña de un programa',
    '¿Cómo configurar la licencia del sistema?',
    'Cómo resetear el acceso a la consola',
  ];
  for (const message of questions) {
    assert.equal(isTechnicalKnowledgeQuery({ message }), true, message);
    const intent = classifyAiIntent({ message });
    assert.ok([AI_INTENTS.KNOWLEDGE, AI_INTENTS.KNOWLEDGE_DOCUMENTS].includes(intent), message);
    assert.deepEqual(toolNamesForIntent(intent), KNOWLEDGE_TOOLS);
  }
});

test('no convierte consultas operativas en búsquedas documentales', () => {
  assert.equal(classifyAiIntent({message:'Muéstrame las boletas pendientes'}), AI_INTENTS.TICKETS);
  // Caracteriza el dominio operacional actual, sin alterar la prioridad existente del router.
  assert.equal(classifyAiIntent({message:'¿Cuántos mantenimientos existen?'}), AI_INTENTS.MAINTENANCE);
  assert.equal(classifyAiIntent({message:'Total de mantenimientos'}), AI_INTENTS.STATISTICS);
  assert.equal(classifyAiIntent({message:'¿Qué evidencias tiene este mantenimiento?'}), AI_INTENTS.MAINTENANCE_EVIDENCE);
});

test('técnico y administrador reciben idéntico repertorio para documentación autorizada', () => {
  const technician = { user:{UsuarioID:'T1'}, permissions:['BOLETAS_VER'] };
  const admin = { user:{UsuarioID:'A1'}, permissions:['USUARIOS_GESTIONAR'] };
  assert.equal(aiAccess(technician).knowledge, true);
  assert.equal(aiAccess(admin).knowledge, true);
  const chosen = toolNamesForIntent(AI_INTENTS.KNOWLEDGE);
  const names = (ctx) => declarationsForUser(ctx,{intent:AI_INTENTS.KNOWLEDGE,selectedNames:chosen})
    .filter((tool) => tool.type === 'function').map((tool) => tool.name);
  assert.deepEqual(names(technician), KNOWLEDGE_TOOLS);
  assert.deepEqual(names(admin), KNOWLEDGE_TOOLS);
  assert.equal(names(technician).includes('search_cases'),false);
  assert.equal(names(technician).includes('search_network_devices'),false);
});

test('mantiene publicados o propios para técnico sin abrir borradores ajenos', () => {
  const params=[];
  const sql=appendKnowledgeVisibility({user:{UsuarioID:'T1'},permissions:['BOLETAS_VER']},params,'a');
  assert.match(sql,/PUBLICADO/);
  assert.match(sql,/AutorUsuarioID/);
  assert.deepEqual(params,['T1']);
  assert.equal(appendKnowledgeVisibility({user:{UsuarioID:'A1'},permissions:['USUARIOS_GESTIONAR']},[],'a'),'TRUE');
});
