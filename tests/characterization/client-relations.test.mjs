import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildClientRelations } from '../../backend/src/services/client-relations.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('agrupa únicamente relaciones activas del cliente solicitado', () => {
  const result = buildClientRelations({
    clientId: 'CLIENTE-1',
    locations: [
      { UbicacionID: 'U-2', ClienteID: 'CLIENTE-1', Nombre: 'Sucursal B', Estado: 'ACTIVO' },
      { UbicacionID: 'U-1', ClienteID: 'CLIENTE-1', Nombre: 'Sucursal A', Estado: 'ACTIVO' },
      { UbicacionID: 'U-3', ClienteID: 'CLIENTE-2', Nombre: 'Otra', Estado: 'ACTIVO' },
      { UbicacionID: 'U-4', ClienteID: 'CLIENTE-1', Nombre: 'Cerrada', Estado: 'INACTIVO' },
    ],
    equipment: [
      { UbicacionEquipoID: 'E-2', UbicacionID: 'U-2', Nombre: 'Cuarto 2', Estado: 'ACTIVO' },
      { UbicacionEquipoID: 'E-1', UbicacionID: 'U-1', Nombre: 'Cuarto 1', Estado: 'ACTIVO' },
      { UbicacionEquipoID: 'E-3', UbicacionID: 'U-3', Nombre: 'Ajeno', Estado: 'ACTIVO' },
      { UbicacionEquipoID: 'E-4', UbicacionID: 'U-1', Nombre: 'Inactivo', Activo: false },
    ],
    contacts: [
      { ContactoID: 'C-2', ClienteID: 'CLIENTE-1', Nombre: 'Zeta', Estado: 'ACTIVO' },
      { ContactoID: 'C-1', ClienteID: 'CLIENTE-1', Nombre: 'Ana', Estado: 'ACTIVO' },
      { ContactoID: 'C-3', ClienteID: 'CLIENTE-2', Nombre: 'Ajeno', Estado: 'ACTIVO' },
    ],
  });

  assert.deepEqual(result.locations.map((row) => row.UbicacionID), ['U-1', 'U-2']);
  assert.deepEqual(result.equipment.map((row) => row.UbicacionEquipoID), ['E-1', 'E-2']);
  assert.deepEqual(result.contacts.map((row) => row.ContactoID), ['C-1', 'C-2']);
  assert.deepEqual(result.counts, { locations: 2, equipment: 2, contacts: 2 });
});

test('puede incluir registros inactivos únicamente cuando el handler lo autoriza', () => {
  const result = buildClientRelations({
    clientId: 'CLIENTE-1',
    includeInactive: true,
    locations: [{ UbicacionID: 'U-1', ClienteID: 'CLIENTE-1', Nombre: 'Cerrada', Estado: 'INACTIVO' }],
    equipment: [{ UbicacionEquipoID: 'E-1', UbicacionID: 'U-1', Nombre: 'Equipo', Estado: 'INACTIVO' }],
    contacts: [{ ContactoID: 'C-1', ClienteID: 'CLIENTE-1', Nombre: 'Contacto', Estado: 'INACTIVO' }],
  });

  assert.equal(result.locations.length, 1);
  assert.equal(result.equipment.length, 1);
  assert.equal(result.contacts.length, 1);
});

test('Clientes usa paginación compartida y una sola carga relacionada', () => {
  const page = source('src/pages/admin/ClientsPage.jsx');
  const service = source('src/services/clientRelations.js');
  const module = source('backend/src/modules/client-relations.module.js');
  const router = source('backend/src/core/action-router.js');

  assert.match(page, /usePaginatedResource/);
  assert.match(page, /fetchClientRelations/);
  assert.doesNotMatch(page, /mapWithConcurrency/);
  assert.doesNotMatch(page, /requestSequence/);
  assert.match(service, /clients\.relations\.get/);
  assert.match(service, /loadLegacyRelations/);
  assert.match(module, /readTables\(\[/);
  assert.match(router, /clients\.relations\.get/);
});
