import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTicketHistorySnapshot, TICKET_HISTORY_FIELDS } from '../src/modules/tickets.module.js';

test('historical ticket snapshot keeps business fields but never exposes internal secrets or Drive URLs', () => {
  const raw = JSON.stringify({
    Titulo: 'Cambio de cámara', Resultado: 'Funcionando tras ajuste',
    HorasTotales: 1.5, EnviarCorreoCliente: false,
    AsignadoA: ['Técnico Uno', 'Técnico Dos'],
    PasswordHash: 'secret', Token: 'secret', ChatWebhook: 'secret',
    FirmaURL: 'https://drive.google.com/secret', IP: '10.0.0.1',
  });
  assert.deepEqual(sanitizeTicketHistorySnapshot(raw), {
    Titulo: 'Cambio de cámara', HorasTotales: 1.5,
    Resultado: 'Funcionando tras ajuste',
    EnviarCorreoCliente: false,
    AsignadoA: ['Técnico Uno', 'Técnico Dos'],
  });
  assert.ok(TICKET_HISTORY_FIELDS.includes('RazonVisita'));
  assert.ok(TICKET_HISTORY_FIELDS.includes('CorreoSupervisor'));
  assert.equal(TICKET_HISTORY_FIELDS.includes('FirmaURL'), false);
});

test('legacy audit JSON with invalid or incomplete snapshot is sanitized safely', () => {
  assert.deepEqual(sanitizeTicketHistorySnapshot('{broken'), {});
  assert.deepEqual(sanitizeTicketHistorySnapshot(null), {});
  assert.deepEqual(sanitizeTicketHistorySnapshot('[]'), {});
  assert.deepEqual(sanitizeTicketHistorySnapshot('{"Titulo":"Antes","AsignadoA":[{"Token":"secret"},"Técnico"]}'), {
    Titulo: 'Antes', AsignadoA: ['Técnico'],
  });
  assert.deepEqual(sanitizeTicketHistorySnapshot({ Estado: 'FINALIZADA', Descripcion: null }), {
    Estado: 'FINALIZADA', Descripcion: '',
  });
});
