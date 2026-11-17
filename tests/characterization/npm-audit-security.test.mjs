import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAudit } from '../../scripts/check-dependency-audit.mjs';

const names = ['picomatch', 'fdir', 'tinyglobby', 'vite'];
const advisory = {
  name: 'picomatch',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  severity: 'high',
};
function fixture() {
  const vulnerabilities = Object.fromEntries(names.map((name) => [name, {
    severity: 'high',
    nodes: [`node_modules/${name}`],
    via: name === 'picomatch' ? [{ ...advisory }] : ['picomatch'],
  }]));
  return {
    audit: {
      metadata: { vulnerabilities: { high: 4, critical: 0, moderate: 2 } },
      vulnerabilities,
    },
    lock: {
      packages: Object.fromEntries(names.map((name) => [`node_modules/${name}`, { version: '1.0.0', dev: true }])),
    },
    environment: 'frontend',
    now: new Date('2026-11-17T12:00:00Z'),
  };
}

test('admite temporalmente solo el aviso conocido en dependencias dev', () => {
  assert.deepEqual(checkAudit(fixture()).exceptions, ['GHSA-fc5q-39xc-vjpf']);
});

test('no admite avisos de otros proveedores o paquetes', () => {
  const entry = fixture();
  entry.audit.vulnerabilities.esbuild = {
    severity: 'high', nodes: ['node_modules/esbuild'], via: [{ name: 'esbuild', severity: 'high' }],
  };
  entry.audit.metadata.vulnerabilities.high += 1;
  assert.throws(() => checkAudit(entry), /distinto|alcance/);
});

test('no permite ocultar vulnerabilidades nuevas bajo picomatch', () => {
  const entry = fixture();
  entry.audit.vulnerabilities.picomatch.via.push({ name: 'picomatch', url: 'https://github.com/advisories/GHSA-otra', severity: 'high' });
  assert.throws(() => checkAudit(entry), /único aviso/);
});

test('no permite excepciones en paquetes de producción', () => {
  const entry = fixture();
  entry.lock.packages['node_modules/vite'].dev = false;
  assert.throws(() => checkAudit(entry), /distinto/);
});

test('rechaza cualquier vulnerabilidad crítica', () => {
  const entry = fixture();
  entry.audit.vulnerabilities.vite.severity = 'critical';
  entry.audit.metadata.vulnerabilities.high -= 1;
  entry.audit.metadata.vulnerabilities.critical += 1;
  assert.throws(() => checkAudit(entry), /distinto/);
});

test('las excepciones vencen sin extenderse automáticamente', () => {
  const entry = fixture();
  entry.now = new Date('2026-12-18T00:00:00Z');
  assert.throws(() => checkAudit(entry), /expiró/);
});

test('los reportes de backend siguen rechazando cualquier aviso alto', () => {
  const entry = fixture();
  entry.environment = 'backend';
  assert.throws(() => checkAudit(entry), /backend/);
});

test('requiere datos de auditoría válidos y un resumen coherente', () => {
  const entry = fixture();
  entry.audit.metadata.vulnerabilities.high = 3;
  assert.throws(() => checkAudit(entry), /resumen/);
  assert.throws(() => checkAudit({ environment: 'frontend', audit: {} }), /no es válido/);
});

test('no oculta avisos de severidad media, pero tampoco cambia el umbral actual', () => {
  const entry = {
    audit: { metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 2 } }, vulnerabilities: { 'react-router': { severity: 'moderate' } } },
    environment: 'frontend',
  };
  assert.deepEqual(checkAudit(entry).exceptions, []);
});
