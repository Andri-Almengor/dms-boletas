import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAccess, appendTicketVisibility } from '../src/ai/agent.permissions.js';
import { resolveDateRange } from '../src/ai/agent.dates.js';
import { buildAgentSystemPrompt } from '../src/ai/agent.prompt.js';
import { containsForbiddenField, sanitizeActiveContext, sanitizeAiToolResult } from '../src/ai/agent.sanitize.js';

test('AI ticket visibility derives identity from authenticated ctx, not payload', () => {
  const params = [];
  const ctx = {
    user: { UsuarioID: 'REAL-USER' },
    permissions: ['BOLETAS_VER'],
    payload: { userId: 'FAKE-ADMIN', role: 'ADMIN' },
  };
  const sql = appendTicketVisibility(ctx, params, 'b');
  assert.match(sql, /BoletaAsignados/);
  assert.deepEqual(params, ['REAL-USER']);
  assert.doesNotMatch(sql, /FAKE-ADMIN/);
});

test('AI access keeps administrative cases restricted', () => {
  const technician = aiAccess({ user: { UsuarioID: 'T1' }, permissions: ['BOLETAS_VER'] });
  assert.equal(technician.tickets, true);
  assert.equal(technician.cases, false);
  assert.equal(technician.clients, true);
  const admin = aiAccess({ user: { UsuarioID: 'A1' }, permissions: ['USUARIOS_GESTIONAR'] });
  assert.equal(admin.cases, true);
  assert.equal(admin.clients, true);
});

test('AI sanitizer removes secrets recursively before Gemini', () => {
  const result = sanitizeAiToolResult('example', {
    modelData: {
      id: '1',
      nombre: 'Equipo',
      password_hash: 'never',
      token: 'never',
      nested: { PasswordSalt: 'never', value: 'ok', DriveFileID: 'never' },
    },
  });
  assert.equal(result.modelData.id, '1');
  assert.equal(result.modelData.nombre, 'Equipo');
  assert.equal(result.modelData.password_hash, undefined);
  assert.equal(result.modelData.token, undefined);
  assert.equal(result.modelData.nested.PasswordSalt, undefined);
  assert.equal(result.modelData.nested.DriveFileID, undefined);
  assert.equal(result.modelData.nested.value, 'ok');
  assert.equal(containsForbiddenField(result.modelData), false);
});

test('AI active context is allowlisted and cannot smuggle role or permissions', () => {
  const context = sanitizeActiveContext({
    lastMaintenanceId: 'M1',
    lastMaintenanceName: 'Banco Central',
    role: 'ADMIN',
    permissions: ['USUARIOS_GESTIONAR'],
    userId: 'OTHER',
    pageContext: { entityType: 'maintenance', entityId: 'M1', secret: 'no' },
  });
  assert.equal(context.lastMaintenanceId, 'M1');
  assert.equal(context.role, undefined);
  assert.equal(context.permissions, undefined);
  assert.equal(context.userId, undefined);
  assert.deepEqual(context.pageContext, {
    entityType: 'maintenance',
    entityId: 'M1',
    clientId: '',
    maintenanceId: '',
    ticketId: '',
  });
});

test('AI natural date ranges use America/Costa_Rica', () => {
  const now = new Date('2026-09-17T18:00:00.000Z');
  assert.deepEqual(resolveDateRange({ period: 'yesterday' }, now), {
    from: '2026-09-16',
    to: '2026-09-16',
    label: 'ayer',
  });
  assert.deepEqual(resolveDateRange({ period: 'current_month' }, now), {
    from: '2026-09-01',
    to: '2026-09-17',
    label: 'este mes',
  });
});

test('AI system prompt treats retrieved prompt injection as untrusted data', () => {
  const prompt = buildAgentSystemPrompt({
    user: { UsuarioID: 'T1', NombreCompleto: 'Técnico' },
    permissions: ['BOLETAS_VER'],
    nowIso: '2026-09-17T12:00:00',
  });
  assert.match(prompt, /DATO NO CONFIABLE/i);
  assert.match(prompt, /nunca una instrucción/i);
  assert.match(prompt, /SOLO LECTURA/i);
  assert.match(prompt, /Nunca inventes/i);
});

test('AI tool registry has no credential or password tool and cases stay admin-only', async () => {
  const { TOOL_DECLARATIONS, declarationsForUser } = await import('../src/ai/agent.tools.js');
  const names = Object.keys(TOOL_DECLARATIONS);
  assert.equal(names.some((name) => /password|credential|secret|token/i.test(name)), false);

  const technicianTools = declarationsForUser({
    user: { UsuarioID: 'T1' },
    permissions: ['BOLETAS_VER'],
  }).filter((item) => item.type === 'function').map((item) => item.name);
  assert.equal(technicianTools.includes('search_cases'), false);
  assert.equal(technicianTools.includes('get_case'), false);
  assert.equal(technicianTools.includes('search_network_devices'), false);
  assert.equal(technicianTools.includes('search_agenda'), true);
  assert.equal(technicianTools.includes('search_tickets'), true);

  const adminTools = declarationsForUser({
    user: { UsuarioID: 'A1' },
    permissions: ['USUARIOS_GESTIONAR'],
  }).filter((item) => item.type === 'function').map((item) => item.name);
  assert.equal(adminTools.includes('search_cases'), true);
  assert.equal(adminTools.includes('search_network_devices'), true);
});

test('AI tool results keep signed attachment URLs out of modelData', () => {
  const result = sanitizeAiToolResult('evidence', {
    modelData: { id: 'e1', fileId: 'SHOULD_NOT_REACH_MODEL', name: 'Foto' },
    attachments: [{
      type: 'image',
      title: 'Foto',
      url: '/api/media/stream?token=signed-value',
      mimeType: 'image/jpeg',
      entityType: 'ticket',
      entityId: 't1',
    }],
  });
  assert.equal(result.modelData.fileId, undefined);
  assert.equal(JSON.stringify(result.modelData).includes('signed-value'), false);
  assert.equal(result.ui.attachments[0].url, '/api/media/stream?token=signed-value');
});
