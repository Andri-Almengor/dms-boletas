import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildMaintenanceTicketDraft,
  maintenanceDeviceChecks,
  mergeImprovedMaintenanceDraft,
} from '../../backend/src/services/maintenance-ticket-report.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

function sampleBundle() {
  return {
    maintenance: {
      Cliente: 'Cliente de prueba',
      Ubicacion: 'Edificio principal',
    },
    client: { Nombre: 'Cliente de prueba' },
  };
}

function sampleGroup() {
  return {
    date: '2026-07-31',
    technicians: [{ name: 'Técnico Uno' }, { name: 'Técnico Dos' }],
    devices: [
      {
        NombreDispositivo: 'Cámara pasillo',
        Categoria: 'Cámara',
        Zona: 'Oficina 1',
        Fabricante: 'Axis',
        Modelo: 'M3085-V',
        Funcionamiento: 'Sí',
        EnUso: 'Sí, en uso',
        Estado: 'CORRECTO',
        RespuestasJSON: JSON.stringify({
          preguntas: [
            { Pregunta: 'Limpieza', Respuesta: 'Sí' },
            { label: 'Alimentación', value: 'Sí' },
            { label: 'Conexión de red o video', value: 'Sí' },
            { label: 'Montaje', value: 'Correcto' },
            { label: 'Visualización y grabación', value: 'Funciona correctamente' },
          ],
        }),
      },
      {
        NombreDispositivo: 'Cámara acceso',
        Categoria: 'Cámara',
        Zona: 'Recepción',
        Fabricante: 'Axis',
        Modelo: 'P3265-LV',
        Funcionamiento: 'No',
        EnUso: 'Sí, en uso',
        Estado: 'PENDIENTE',
        Observacion: 'No aparece en el grabador y se debe confirmar su conectividad',
        RespuestasJSON: JSON.stringify({
          __preguntas: [
            { label: 'Limpieza', value: 'Sí' },
            { label: 'Alimentación', value: 'No' },
            { label: 'Conexión', value: 'Pendiente de verificar' },
          ],
        }),
      },
    ],
  };
}

test('convierte preguntas dinámicas en verificaciones legibles', () => {
  const checks = maintenanceDeviceChecks(sampleGroup().devices[0]);
  assert.deepEqual(checks.map(([label]) => label), [
    'Funcionamiento general',
    'Condición de uso',
    'Limpieza',
    'Alimentación',
    'Conexión de red o video',
    'Montaje',
    'Visualización y grabación',
  ]);
  assert.equal(checks.some(([, value]) => value.includes('[object Object]')), false);
});

test('redacta pruebas y resultados como informe de jornada', () => {
  const report = buildMaintenanceTicketDraft(sampleBundle(), sampleGroup());
  const completeText = [
    report.razonVisita,
    report.descripcion,
    report.pruebasRealizadas,
    report.resultado,
    report.recomendaciones,
  ].join('\n');

  assert.doesNotMatch(completeText, /\[object Object\]/i);
  assert.doesNotMatch(completeText, /la funcionamiento/i);
  assert.match(report.razonVisita, /Durante la jornada del 31 de julio de 2026/);
  assert.match(report.razonVisita, /Técnico Uno y Técnico Dos realizaron labores/);
  assert.match(report.pruebasRealizadas, /Cámara pasillo/);
  assert.match(report.pruebasRealizadas, /Oficina 1/);
  assert.match(report.pruebasRealizadas, /Se comprobaron satisfactoriamente/);
  assert.match(report.resultado, /1 dispositivo quedó conforme/);
  assert.match(report.resultado, /1 dispositivo quedó pendiente/);
  assert.match(report.resultado, /Cámara acceso/);
  assert.match(report.resultado, /Recepción/);
  assert.match(report.resultado, /No aparece en el grabador/);
});

test('rechaza mejoras de IA que vuelvan a introducir objetos sin serializar', () => {
  const raw = buildMaintenanceTicketDraft(sampleBundle(), sampleGroup());
  const merged = mergeImprovedMaintenanceDraft(raw, {
    pruebasRealizadas: '[object Object]',
    resultado: { dato: { inesperado: true } },
    recomendaciones: 'Dar seguimiento al dispositivo pendiente.',
  });

  assert.equal(merged.pruebasRealizadas, raw.pruebasRealizadas);
  assert.equal(merged.resultado, raw.resultado);
  assert.equal(merged.recomendaciones, 'Dar seguimiento al dispositivo pendiente.');
});

test('el Apps Script limpia el final de la plantilla antes de anexar evidencias', () => {
  const code = source('apps-script/boletas-report/Code.gs');
  assert.match(code, /function hasAnnexContent_\(/);
  assert.match(code, /function removeTrailingPageArtifacts_\(body\)/);
  assert.match(code, /paragraphHasPageBreak_/);
  assert.match(code, /removeTrailingPageArtifacts_\(body\);[\s\S]*body\.appendPageBreak\(\)/);
  assert.doesNotMatch(code, /body\.appendParagraph\('Sin evidencias asociadas\.'\)/);
  assert.equal((code.match(/function hasAnnexContent_\(/g) || []).length, 1);
  assert.equal((code.match(/function appendAnnexes_\(/g) || []).length, 1);
});
