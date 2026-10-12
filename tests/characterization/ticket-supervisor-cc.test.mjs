import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const PRIMARY = 'yehuda.karmona@solutionsdms.com';

// Ejecuta la resolución real de destinatarios sin PostgreSQL ni Apps Script.
function recipientsFor(relativePath, bundle, settings, testMode = false, override = null) {
  const code = source(relativePath);
  const from = (signature) => {
    const start = code.indexOf(signature);
    assert.ok(start >= 0, 'No se encontró ' + signature + ' en ' + relativePath);
    const end = code.indexOf('\nfunction ', start + signature.length);
    assert.ok(end > start, 'No se identificó el fin de ' + signature);
    return code.slice(start, end);
  };
  const mainEmail = code.match(/const TICKET_PRIMARY_EMAIL = '[^']+';/)?.[0];
  assert.ok(mainEmail, 'El destinatario principal debe estar declarado');

  const snippet = [
    mainEmail,
    from('function clean('),
    from('function splitEmails('),
    from('function resolveRecipients('),
    'resolveRecipients(bundle, settings, testMode, override);',
  ].join('\n');

  return JSON.parse(JSON.stringify(runInNewContext(snippet, {
    bundle,
    settings,
    config: settings,
    testMode,
    override,
    process: { env: { TEST_NOTIFICATION_EMAIL: '' } },
  })));
}

const variants = [
  {
    name: 'boleta individual',
    path: 'backend/src/services/apps-script-ticket.service.js',
    settings: { DEFAULT_CC_EMAILS: 'global@dms.test; jefa@cliente.test', TEST_EMAIL: 'pruebas@dms.test' },
    bundle: {
      ticket: {
        CorreoSupervisor: ' JEFA@CLIENTE.TEST ; jefa@cliente.test ; invalido ; yehuda.karmona@solutionsdms.com',
        CorreosCC: 'extra@dms.test',
        CorreoCliente: 'cliente@cliente.test',
        EnviarCorreoCliente: false,
      },
      assigned: [{ Correo: 'tecnico@dms.test' }],
    },
  },
  {
    name: 'grupo de visitas',
    path: 'backend/src/services/apps-script-ticket-group.service.js',
    settings: {
      ticketDefaultCc: 'global@dms.test; jefa@cliente.test',
      testRecipients: 'pruebas@dms.test',
      testCc: 'pruebascc@dms.test',
    },
    bundle: {
      ticket: {
        CorreoSupervisor: 'JEFA@CLIENTE.TEST',
        CorreosCC: 'extra@dms.test',
        CorreoCliente: 'cliente@cliente.test',
        EnviarCorreoCliente: false,
      },
      visits: [
        { ticket: { CorreoSupervisor: 'JEFA@CLIENTE.TEST ; invalido' } },
        { ticket: { CorreoSupervisor: 'jefe2@cliente.test; jefa@cliente.test ; yehuda.karmona@solutionsdms.com' } },
      ],
      assigned: [{ Correo: 'tecnico@dms.test' }],
    },
  },
];

for (const scenario of variants) {
  test(scenario.name + ': supervisor válido entra a CC sin marcar copia al cliente', () => {
    const result = recipientsFor(scenario.path, scenario.bundle, scenario.settings);
    assert.deepEqual(result.to, [PRIMARY]);
    assert.ok(result.cc.includes('jefa@cliente.test'));
    assert.ok(result.cc.includes('tecnico@dms.test'));
    assert.ok(result.cc.includes('global@dms.test'));
    assert.ok(result.cc.includes('extra@dms.test'));
    assert.equal(result.cc.filter((item) => item === 'jefa@cliente.test').length, 1);
    assert.ok(!result.cc.includes(PRIMARY));
    assert.ok(!result.cc.includes('invalido'));
    assert.ok(!result.cc.includes('cliente@cliente.test'));
    if (scenario.bundle.visits) assert.ok(result.cc.includes('jefe2@cliente.test'));

    // El checkbox histórico no debe eliminar ni duplicar el CC del supervisor.
    const withCheckbox = recipientsFor(scenario.path, {
      ...scenario.bundle,
      ticket: { ...scenario.bundle.ticket, EnviarCorreoCliente: true },
    }, scenario.settings);
    assert.deepEqual(withCheckbox, result);
  });

  test(scenario.name + ': los envíos de prueba no incluyen supervisores reales', () => {
    const result = recipientsFor(scenario.path, scenario.bundle, scenario.settings, true);
    assert.deepEqual(result.to, ['pruebas@dms.test']);
    assert.ok(!result.cc.includes('jefa@cliente.test'));
    assert.ok(!result.cc.includes('jefe2@cliente.test'));
  });

  test(scenario.name + ': override de producción mantiene supervisor en CC', () => {
    const result = recipientsFor(scenario.path, scenario.bundle, scenario.settings, false, {
      to: ['destinatario@dms.test', PRIMARY],
      cc: ['otros@dms.test'],
    });
    assert.deepEqual(result.to, [PRIMARY]);
    assert.ok(result.cc.includes('jefa@cliente.test'));
    assert.ok(result.cc.includes('destinatario@dms.test'));
    assert.ok(result.cc.includes('otros@dms.test'));
    assert.ok(!result.cc.includes(PRIMARY));
  });
}

test('Apps Script conserva el CC remitido desde backend, TO, adjuntos y alias', () => {
  const script = source('apps-script/report-service/Code.gs');
  for (const name of ['sendReportEmail_', 'sendVisitGroupEmail_']) {
    const fromIndex = script.indexOf('function ' + name + '(');
    assert.ok(fromIndex >= 0);
    const until = script.indexOf('\nfunction ', fromIndex + 10);
    const functionText = script.slice(fromIndex, until);
    assert.match(functionText, /uniqueEmails_\(data\.recipients\.to/);
    assert.match(functionText, /uniqueEmails_\(data\.recipients\.cc/);
    assert.match(functionText, /sendDirectAttachmentEmails_/);
  }
  assert.match(script, /DMS_EMAIL_FROM_ALIAS = 'reportes@solutionsdms.com'/);
  assert.match(script, /linkVideos: true/);
});
