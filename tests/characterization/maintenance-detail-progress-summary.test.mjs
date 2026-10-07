import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  countMaintenanceDevicesByCategory,
  countMaintenanceEvidence,
} from '../../src/features/maintenance/maintenanceFormDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el detalle y el Paso 4 reutilizan el mismo resumen de avance de dispositivos', () => {
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const review = source('src/components/maintenance/MaintenanceReviewStep.jsx');
  const summary = source('src/components/maintenance/MaintenanceDeviceProgressSummary.jsx');

  assert.match(detail, /MaintenanceDeviceProgressSummary/);
  assert.match(detail, /AVANCE DE DISPOSITIVOS/);
  assert.match(detail, /counts=\{maintenanceCounts\}/);
  assert.match(detail, /deviceTypes=\{maintenanceCatalogs\.deviceTypes\}/);
  assert.match(review, /MaintenanceDeviceProgressSummary/);
  assert.doesNotMatch(review, /className="maintenance-review__stats"/);
  assert.match(summary, /maintenance-review__stats/);
  assert.match(summary, /maintenance-category-review/);
  assert.match(summary, />esperados</);
  assert.match(summary, />registrados</);
  assert.match(summary, />evidencias</);
  assert.match(summary, /buildDynamicMaintenanceCategories/);
});

test('los contadores compartidos aceptan la forma de datos del detalle y del editor', () => {
  const devices = [
    {
      Categoria: 'Cámaras',
      Imagenes: [{ id: 'a' }, { id: 'b' }],
    },
    {
      TipoDispositivo: 'Puerta',
      Imagenes: [{ id: 'c' }],
    },
    {
      categoria: 'Panel',
      images: [{ id: 'd' }],
      newImages: [{ id: 'e' }],
    },
  ];

  assert.deepEqual(countMaintenanceDevicesByCategory(devices), {
    'Cámara': 1,
    Puertas: 1,
    Panel: 1,
  });
  assert.equal(countMaintenanceEvidence(devices), 5);
});

test('la firma general queda plegable y cerrada por defecto también en escritorio', () => {
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const styles = source('src/styles/maintenance-signature-fixes.css');

  assert.match(detail, /const \[signatureOpen, setSignatureOpen\] = useState\(false\)/);
  assert.match(detail, /className="maintenance-mobile-fold--signature"/);
  assert.match(detail, /open=\{signatureOpen\}/);
  assert.match(styles, /@media \(min-width: 761px\)/);
  assert.match(styles, /\.maintenance-mobile-fold--signature \.maintenance-mobile-fold__trigger/);
  assert.match(styles, /\.maintenance-mobile-fold--signature \.maintenance-mobile-fold__content \{[\s\S]*display: none;/);
  assert.match(styles, /\.maintenance-mobile-fold--signature\.is-open \.maintenance-mobile-fold__content \{[\s\S]*display: block;/);
});

test('el resumen carga únicamente el catálogo de tipos de dispositivo', () => {
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const review = source('src/components/maintenance/MaintenanceReviewStep.jsx');
  const catalogHook = source('src/hooks/useMaintenanceDeviceCatalogData.js');

  assert.match(detail, /resources: \['deviceTypes'\]/);
  assert.match(review, /resources: \['deviceTypes'\]/);
  assert.match(catalogHook, /resourceKey/);
  assert.match(catalogHook, /allJobs\.filter\(\(\[key\]\) => requested\.has\(key\)\)/);
});
