import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const model = readFileSync(path.join(ROOT, 'src/features/tickets/ticketFormModel.js'), 'utf8');
const page = readFileSync(path.join(ROOT, 'src/pages/tickets/TicketFormPage.jsx'), 'utf8');

function includesAll(contents, fragments) {
  fragments.forEach((fragment) => assert.ok(contents.includes(fragment), `Falta el contrato: ${fragment}`));
}

test('el modelo puro de boletas conserva campos, aliases y payload histórico', () => {
  includesAll(model, [
    'export const TICKET_FORM_STEPS',
    'export function createEmptyTicketForm',
    'export function calculateTicketHours',
    'export function ticketRecord',
    'export function mapTicketForm',
    'export function buildTicketPayload',
    'export function validateTicketStep',
    "['Titulo', 'Título']",
    "['CorreoCliente', 'Correo_Cliente']",
    "['Descripcion', 'Descripción', 'DescripcionEquipo', 'NombreEquipo']",
    'Descripcion: form.nombreDispositivo',
    'AsignadoA: form.asignados',
    'Estado: estado',
  ]);
});

test('la extracción replica los contratos todavía activos en TicketFormPage', () => {
  includesAll(page, [
    "['Información general', 'Título, categoría, tipo de falla, fecha y horas.']",
    "if (minutes < 0) minutes += 1440;",
    "titulo: pick(row, ['Titulo', 'Título'])",
    "correoCliente: pick(row, ['CorreoCliente', 'Correo_Cliente'])",
    'Descripcion: form.nombreDispositivo',
    "return 'Seleccione un cliente.';",
    "return 'Seleccione al menos un técnico.';",
  ]);
});

test('el modelo no acopla estado React, navegación ni solicitudes HTTP', () => {
  ['useState(', 'useEffect(', 'useNavigate(', 'requestAvailable('].forEach((fragment) => {
    assert.equal(model.includes(fragment), false, `El modelo puro no debe contener ${fragment}`);
  });
});
