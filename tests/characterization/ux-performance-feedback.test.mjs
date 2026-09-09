import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las fotos intentan primero el thumbnail y los videos usan el fallback protegido deduplicado', () => {
  const contents = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');
  assert.match(contents, /const initialSource = pick\(image, \['PreviewURL', 'previewUrl', 'DriveURL', 'url'\]\)/);
  assert.match(contents, /const \[source, setSource\] = useState\(kind === 'video' \? '' : initialSource\)/);
  assert.match(contents, /if \(imageId && \(kind === 'video' \|\| !initialSource\)\) loadProtectedMedia\(\)/);
  assert.match(contents, /onError=\{\(\) => \{/);
  assert.match(contents, /protectedMediaCache/);
  assert.match(contents, /protectedMediaRequests/);
  assert.match(contents, /<video src=\{source\} controls/);
  assert.doesNotMatch(contents, /isProtectedGoogleUrl/);
});

test('el mantenimiento muestra ubicaciones conocidas antes de terminar la relación del cliente', () => {
  const resources = source('src/features/maintenance/useMaintenanceResources.js');
  const quickCreator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  assert.match(resources, /initialEquipmentFromDevices/);
  assert.match(resources, /setAllEquipment\(initialEquipmentFromDevices\(mappedDevices, mappedForm\)\)/);
  assert.match(quickCreator, /if \(initialEquipmentLocation\?\.id\) \{/);
  assert.match(quickCreator, /mergeEquipmentOptions\(locationId\)\.catch/);
});

test('los fabricantes se precargan sin bloquear la apertura del formulario', () => {
  const contents = source('src/features/tickets/useTicketFormResources.js');
  assert.match(contents, /manufacturerMasterStatus/);
  assert.match(contents, /Se inicia al abrir el formulario, sin retrasar la pantalla inicial/);
  assert.match(contents, /manufacturersForType/);
  assert.match(contents, /Respaldo para una precarga fallida/);
});

test('las operaciones largas y el inventario móvil conservan retroalimentación y legibilidad', () => {
  const overlay = source('src/components/feedback/ProcessingOverlay.jsx');
  const ticket = source('src/pages/tickets/TicketFormPage.jsx');
  const maintenance = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const location = source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  const inlineModal = source('src/components/forms/InlineCreateModal.jsx');
  const mobileStyles = source('src/styles/maintenance-inventory-mobile.css');
  const styleIndex = source('src/styles/index.css');

  assert.match(overlay, /aria-busy="true"/);
  assert.match(ticket, /title="Finalizando boleta"|Finalizando boleta/);
  assert.match(ticket, /<ProcessingOverlay open=\{saving\}/);
  assert.match(maintenance, /Guardando dispositivo/);
  assert.match(maintenance, /Finalizando mantenimiento/);
  assert.match(location, /title="Agregando ubicación"/);
  assert.match(inlineModal, /title="Guardando registro"/);

  assert.match(styleIndex, /maintenance-inventory-mobile\.css/);
  assert.match(mobileStyles, /@media \(max-width: 720px\)/);
  assert.match(mobileStyles, /display: flex !important/);
  assert.match(mobileStyles, /maintenance-device-list__icon \+ span/);
  assert.match(mobileStyles, /inline-size: 0 !important/);
  assert.match(mobileStyles, /flex: 1 1 0 !important/);
  assert.match(mobileStyles, /white-space: normal !important/);
  assert.match(mobileStyles, /overflow-wrap: anywhere/);
  assert.match(mobileStyles, /\.maintenance-inventory-mobile-edit/);
  assert.match(mobileStyles, /padding-bottom: calc\(var\(--bottom-nav-height\)/);
});

test('el selector de técnicos muestra la lista y usa un desplegable funcional en escritorio', () => {
  const contents = source('src/components/forms/TechnicianMultiSelect.jsx');
  const desktopStyles = source('src/styles/maintenance-device-desktop-fixes.css');
  assert.match(contents, /type="search"/);
  assert.match(contents, /aria-label="Buscar técnicos por nombre o correo"/);
  assert.match(contents, /const \[optionsOpen, setOptionsOpen\] = useState\(true\)/);
  assert.match(contents, /technician-select__toggle/);
  assert.match(contents, /is-options-open/);
  assert.match(contents, /expand_less|expand_more/);
  assert.match(contents, /onFocus=\{\(\) => setOptionsOpen\(true\)\}/);
  assert.match(desktopStyles, /\.technician-select\.is-options-open \.technician-options/);
  assert.match(desktopStyles, /@media \(max-width: 760px\)[\s\S]*\.technician-select__toggle\s*\{[\s\S]*display: none/);
});

test('el detalle limpia la evidencia y adapta la firma al modo oscuro', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const darkStyles = source('src/styles/theme-dark-coverage.css');

  assert.match(detail, /const \[evidenceInputVersion, setEvidenceInputVersion\] = useState\(0\)/);
  assert.match(detail, /function clearEvidenceForm\(\)/);
  assert.match(detail, /setEvidenceInputVersion\(\(current\) => current \+ 1\)/);
  assert.match(detail, /key=\{`camera-\$\{evidenceInputVersion\}`\}/);
  assert.match(detail, /key=\{`file-\$\{evidenceInputVersion\}`\}/);
  assert.match(detail, /clearEvidenceForm\(\);/);
  assert.doesNotMatch(detail, /formElement\?\.reset\(\)/);

  assert.match(darkStyles, /signature-pad canvas/);
  assert.match(darkStyles, /signature-display img/);
  assert.match(darkStyles, /filter: invert\(1\) hue-rotate\(180deg\)/);
  assert.match(darkStyles, /La firma se presenta oscura sin alterar el PNG original/);
});

test('el enlace público de firma conserva un tema claro independiente', () => {
  const routeStyles = source('src/styles/routes/tickets.js');
  const publicStyles = source('src/styles/public-signature-light-theme.css');

  assert.match(routeStyles, /public-signature-light-theme\.css/);
  assert.match(publicStyles, /color-scheme: light/);
  assert.match(publicStyles, /:root\[data-theme='dark'\] \.public-signature-page/);
  assert.match(publicStyles, /\.public-signature-context > article/);
  assert.match(publicStyles, /\.signature-pad canvas/);
  assert.match(publicStyles, /filter: none !important/);
  assert.match(publicStyles, /recuadro blanco con trazo negro/);
});

test('la firma puede ampliarse sin crear un segundo formulario ni perder el trazo', () => {
  const component = source('src/components/tickets/SignaturePad.jsx');
  const routeStyles = source('src/styles/routes/tickets.js');
  const expandedStyles = source('src/styles/signature-pad-expanded.css');

  assert.match(component, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(component, /Ampliar firma/);
  assert.match(component, /Reducir firma/);
  assert.match(component, /aria-modal=\{expanded \? 'true' : undefined\}/);
  assert.match(component, /event\.key === 'Escape'/);
  assert.match(component, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(component, /className=\{`signature-pad\$\{expanded \? ' is-expanded' : ''\}`\}/);

  assert.match(routeStyles, /signature-pad-expanded\.css/);
  assert.match(expandedStyles, /position: fixed !important/);
  assert.match(expandedStyles, /height: 100dvh !important/);
  assert.match(expandedStyles, /\.public-signature-page \.signature-pad\.is-expanded/);
  assert.match(expandedStyles, /filter: none !important/);
});

test('las acciones largas del detalle, firma pública y encuesta muestran un overlay bloqueante', () => {
  const app = source('src/app/App.jsx');
  const bridge = source('src/components/feedback/ActionProcessingBridge.jsx');

  assert.match(app, /ActionProcessingBridge/);
  assert.match(app, /<Suspense fallback=\{null\}><ActionProcessingBridge \/><\/Suspense>/);
  assert.match(bridge, /<ProcessingOverlay/);
  assert.match(bridge, /Finalizando boleta/);
  assert.match(bridge, /Guardando firma/);
  assert.match(bridge, /Enviando encuesta/);
  assert.match(bridge, /MutationObserver/);
  assert.match(bridge, /button\.disabled/);
  assert.match(bridge, /No cierre ni recargue/);
});
