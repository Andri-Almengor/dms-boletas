/**
 * Política temporal de riesgo para un aviso SIN parche en herramientas de compilación.
 * El control de producción y todos los avisos críticos siguen siendo bloqueantes.
 * La excepción debe revisarse o retirarse antes del 18-12-2026.
 * https://github.com/advisories/GHSA-fc5q-39xc-vjpf
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXCEPTION = Object.freeze({
  advisory: 'GHSA-fc5q-39xc-vjpf',
  packages: new Set(['picomatch', 'fdir', 'tinyglobby', 'vite']),
  expiresAt: '2026-12-17T23:59:59Z',
});

function fatal(message) {
  throw new Error(`Auditoría de dependencias: ${message}`);
}

function isHighOrCritical(value) {
  return value === 'high' || value === 'critical';
}

function declaredDevOnly(lock, vulnerability) {
  const nodes = vulnerability.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  return nodes.every((path) => path.startsWith('node_modules/')
    && lock.packages?.[path]?.dev === true
    && lock.packages[path]?.devOptional !== false);
}

function onlyAcceptedAdvisory(vulnerabilities) {
  const root = vulnerabilities.picomatch;
  if (!root || !Array.isArray(root.via) || !root.via.length) return false;
  if (!root.via.every((via) => (
    typeof via === 'object'
    && via.name === 'picomatch'
    && String(via.url || '').endsWith('/' + EXCEPTION.advisory)
    && via.severity === 'high'
  ))) return false;
  return true;
}

export function checkAudit({ audit, lock, environment, now = new Date() }) {
  if (!audit || !audit.metadata?.vulnerabilities || !audit.vulnerabilities) {
    fatal(`el resultado npm audit de ${environment} no es válido`);
  }
  const vulnerabilities = audit.vulnerabilities;
  const severe = Object.entries(vulnerabilities).filter(([, value]) => isHighOrCritical(value.severity));
  const reported = audit.metadata.vulnerabilities;
  if (severe.length !== Number(reported.high || 0) + Number(reported.critical || 0)) {
    fatal(`el resumen de ${environment} no coincide con sus avisos de seguridad`);
  }
  if (!severe.length) return { environment, exceptions: [], vulnerabilities: reported };

  if (environment !== 'frontend') fatal(`se encontró una vulnerabilidad alta/crítica en ${environment}`);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getTime() > Date.parse(EXCEPTION.expiresAt)) {
    fatal(`expiró la excepción de ${EXCEPTION.advisory}; revisar dependencia y riesgo`);
  }
  if (!lock?.packages || !onlyAcceptedAdvisory(vulnerabilities)) {
    fatal('faltan el lockfile o la evidencia del único aviso autorizado');
  }
  if (severe.some(([name, issue]) => (
    !EXCEPTION.packages.has(name)
      || issue.severity !== 'high'
      || !declaredDevOnly(lock, issue)
      || !Array.isArray(issue.via)
      || !issue.via.length
      || (name !== 'picomatch' && issue.via.some((via) => (
        typeof via !== 'string' || !EXCEPTION.packages.has(via)
      )))
  ))) {
    fatal('aviso alto/crítico distinto al único riesgo de desarrollo aceptado');
  }
  // Un paquete nuevo afectado nunca queda autorizado por pertenecer a un árbol de dependencias similar.
  const names = severe.map(([name]) => name).sort();
  const expectedNames = [...EXCEPTION.packages].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    fatal('cambió el alcance del aviso; requiere una evaluación de riesgo nueva');
  }
  return { environment, exceptions: [EXCEPTION.advisory], vulnerabilities: reported };
}

function main() {
  const [frontendFile, backendFile, frontendLockFile] = process.argv.slice(2);
  if (!frontendFile || !backendFile || !frontendLockFile) {
    fatal('uso: node scripts/check-dependency-audit.mjs <audit-frontend> <audit-backend> <package-lock>');
  }
  const frontend = JSON.parse(readFileSync(frontendFile, 'utf8'));
  const backend = JSON.parse(readFileSync(backendFile, 'utf8'));
  const lock = JSON.parse(readFileSync(frontendLockFile, 'utf8'));
  const result = [
    checkAudit({ audit: frontend, lock, environment: 'frontend' }),
    checkAudit({ audit: backend, environment: 'backend' }),
  ];
  for (const item of result) console.log(JSON.stringify(item));
  console.log('Excepción temporal: GHSA-fc5q-39xc-vjpf, solo dependencias de compilación; el resto sigue bloqueante.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || 'Error de auditoría de dependencias');
    process.exitCode = 1;
  }
}
