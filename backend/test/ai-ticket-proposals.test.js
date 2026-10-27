import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_INTENTS, classifyAiIntent, toolNamesForIntent } from '../src/ai/agent.intent.js';
import { TOOL_DECLARATIONS, declarationsForUser } from '../src/ai/agent.tools.js';
import { aiConfig } from '../src/ai/agent.config.js';
import { ticketMatch, ticketTime, ticketRelationship, ticketUuid } from '../src/ai/agent.repository.operations.js';
import { calculateMinimumOneHourTotalHours } from '../src/core/ticket-hours.js';

test('dictated Costa Rican ticket creation routes only to ticket PREPARE', () => {
  for (const message of [
    'Créame una boleta de la visita de ayer.',
    'Hazme dos boletas del INS.',
    'Haceme una boleta de seguimiento para el BCR.',
    'Crea tres boletas del mismo cliente.',
  ]) {
    const intent = classifyAiIntent({ message });
    assert.equal(intent, AI_INTENTS.WRITE_TICKETS, message);
    assert.ok(toolNamesForIntent(intent).includes('prepare_ticket_batch_create'));
    assert.ok(!toolNamesForIntent(intent).includes('prepare_maintenance_device_bulk_create'));
  }
  assert.equal(classifyAiIntent({message:'Muéstrame las boletas pendientes.'}), AI_INTENTS.TICKETS);
});

test('Gemini can PREPARE but never COMMIT tickets directly', () => {
  assert.ok(TOOL_DECLARATIONS.prepare_ticket_batch_create);
  const names = Object.keys(TOOL_DECLARATIONS);
  assert.equal(names.some(name => /commit.*ticket|ticket.*commit/i.test(name)), false);
  const denied = declarationsForUser({
    user: { UsuarioID: 'T1' }, permissions: ['BOLETAS_VER'],
  }, { intent: AI_INTENTS.WRITE_TICKETS });
  assert.equal(denied.some(tool => tool.name === 'prepare_ticket_batch_create'), false);
  const authorized = declarationsForUser({
    user: { UsuarioID: 'T1' }, permissions: ['BOLETAS_CREAR'],
  }, { intent: AI_INTENTS.WRITE_TICKETS });
  assert.equal(authorized.some(tool => tool.name === 'prepare_ticket_batch_create'), aiConfig.writeEnabled);
});

test('catalog reference selection rejects ambiguous clients and prefers exact IDs', () => {
  const catalog = {client:[
    {id:'C1',name:'Banco Central'},
    {id:'C2',name:'Banco Central'},
  ]};
  assert.equal(ticketMatch(catalog,'client','Banco Central').ambiguous,true);
  assert.equal(ticketMatch(catalog,'client','C2').row.id,'C2');
  assert.equal(ticketMatch(catalog,'client','Cliente Inexistente').row,null);
});

test('timeline validation and one-hour rule preserve real hours and midnight', () => {
  assert.equal(ticketTime('08:30'),'08:30');
  assert.equal(ticketTime('23:59'),'23:59');
  for (const value of ['24:00','11:60','9 am','13:7']) assert.equal(ticketTime(value),'');
  assert.equal(calculateMinimumOneHourTotalHours('08:00','08:30'),1);
  assert.equal(calculateMinimumOneHourTotalHours('08:00','09:15'),1.25);
  assert.equal(calculateMinimumOneHourTotalHours('23:00','01:00'),2);
});

test('follow-up references must be preceding visits, never infer same client means same incident', () => {
  assert.equal(ticketRelationship({},1,[]),null);
  assert.equal(ticketRelationship({followUpOf:1},2,[]).parent,0);
  assert.ok(ticketRelationship({followUpOf:2},1,[]).error);
  assert.ok(ticketRelationship({followUpOf:0},1,[]).error);
  assert.ok(ticketRelationship({followUpOf:1},0,[]).error);
});

test('idempotent ticket identity is stable for retries and unique per item', () => {
  const parent=ticketUuid('operation-123',0);
  assert.equal(ticketUuid('operation-123',0),parent);
  assert.notEqual(ticketUuid('operation-123',1),parent);
  assert.match(parent,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
});
