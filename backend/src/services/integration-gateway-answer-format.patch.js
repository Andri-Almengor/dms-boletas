import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';

const baseChat = assistantDynamicMaintenanceQuestionHandlers.chat;

function clean(value, maxLength = 4000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function inventoryDetails(inventory = {}) {
  const rows = Array.isArray(inventory.rows) ? inventory.rows : [];
  if (inventory.mode === 'manufacturers') {
    return rows.slice(0, 40).map((row) => `• ${row.manufacturer}: ${row.count} cámara(s)`);
  }
  if (inventory.mode === 'locations') {
    return rows.slice(0, 40).map((row) => `• ${row.location} → ${row.equipmentLocation}: ${row.count} cámara(s)`);
  }
  return rows.slice(0, 50).map((row) => [
    `• ${row.name}`,
    row.ip,
    [row.manufacturer, row.model].filter(Boolean).join(' '),
    row.equipmentLocation || row.location,
  ].filter(Boolean).join(' · '));
}

function capabilityDetails(capabilities = {}) {
  const snapshotTransport = capabilities.snapshotTransport ? ` (${capabilities.snapshotTransport})` : '';
  const snapshot = capabilities.snapshot
    ? `Sí${snapshotTransport}`
    : capabilities.snapshotStatus === 'UNDETERMINED'
      ? 'No determinado todavía'
      : 'No';
  const details = [
    `• Captura de imagen: ${snapshot}`,
    `• PTZ ONVIF: ${capabilities.ptz ? 'Sí' : 'No detectado'}`,
    `• Zoom PTZ continuo: ${capabilities.continuousZoom ? 'Sí' : 'No detectado'}`,
  ];
  if (capabilities.opticalZoom) {
    const transport = capabilities.zoomControlTransport ? ` · ${capabilities.zoomControlTransport}` : '';
    const state = capabilities.lensZoomControl
      ? `control disponible${transport}`
      : 'control remoto del lente aún no confirmado';
    details.push(`• Zoom óptico del lente: Sí${capabilities.opticalZoomRatio ? ` (${capabilities.opticalZoomRatio})` : ''}; ${state}`);
  }
  if (capabilities.restoreWide) {
    details.push(`• Restaurar vista amplia/normal: Sí${capabilities.restoreWideTransport ? ` (${capabilities.restoreWideTransport})` : ''}`);
  }
  details.push(
    `• Posición Home PTZ: ${capabilities.homePosition ? 'Sí' : 'No detectada'}`,
    `• Reinicio ONVIF: ${capabilities.reboot ? 'Sí' : 'No'}`,
  );
  return details;
}

function gatewayClientName(result = {}) {
  const source = (result.sources || []).find((item) => item?.type === 'gateway' && item?.label);
  return clean(source?.label || '', 300).replace(/^Gateway\s*·\s*/i, '').trim();
}

function cameraReference(capabilities = {}) {
  const description = clean(capabilities.camera, 400);
  const ip = description.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)\s*$/)?.[1];
  return ip || description;
}

function capabilityCommands(capabilities = {}, result = {}) {
  const client = gatewayClientName(result);
  const camera = cameraReference(capabilities);
  if (!client || !camera) return [];
  const suffix = `cámara ${camera} cliente ${client}`;
  const commands = [];
  if (capabilities.snapshot) commands.push(`gateway dame una captura de la ${suffix}`);
  if (capabilities.continuousZoom || capabilities.lensZoomControl) {
    commands.push(`gateway acercar zoom de la ${suffix}`);
    commands.push(`gateway alejar zoom de la ${suffix}`);
    commands.push(`gateway detener zoom de la ${suffix}`);
  }
  if (capabilities.homePosition || capabilities.restoreWide) {
    commands.push(`gateway volver zoom a normal de la ${suffix}`);
  }
  if (capabilities.reboot) commands.push(`gateway reiniciar la ${suffix}`);
  return commands;
}

assistantDynamicMaintenanceQuestionHandlers.chat = async function formattedGatewayChat(ctx) {
  const result = await baseChat(ctx);
  const question = clean(ctx.payload?.message || ctx.payload?.question, 1500);
  if (!/\bgateway\b/i.test(question) || !result || typeof result !== 'object') return result;

  const inventory = result.facts?.gatewayInventory;
  if (inventory?.rows) {
    const details = inventoryDetails(inventory);
    result.answer = [
      clean(result.answer),
      ...details,
      inventory.rows.length > details.length ? `… y ${inventory.rows.length - details.length} más.` : '',
    ].filter(Boolean).join('\n');
  }

  const capabilities = result.facts?.gatewayCameraCapabilities;
  if (capabilities) {
    const commands = capabilityCommands(capabilities, result);
    result.answer = [
      clean(result.answer),
      'Acciones detectadas mediante ONVIF y adaptadores compatibles del fabricante:',
      ...capabilityDetails(capabilities),
      commands.length ? '' : null,
      commands.length ? 'Comandos que puede ejecutar para esta cámara:' : null,
      ...commands.map((command) => `• ${command}`),
    ].filter((value) => value !== null && value !== undefined).join('\n');
    result.suggestions = [...new Set([...(Array.isArray(result.suggestions) ? result.suggestions : []), ...commands])].slice(0, 8);
  }

  const snapshot = result.facts?.gatewaySnapshot;
  if (snapshot?.url) {
    result.answer = [
      clean(result.answer),
      'La captura es temporal. Ábrala desde la fuente “Captura temporal de cámara”.',
    ].join('\n');
    result.sources = [
      ...(Array.isArray(result.sources) ? result.sources : []),
      {
        type: 'gateway',
        id: snapshot.snapshotId,
        label: 'Captura temporal de cámara',
        url: snapshot.url,
      },
    ];
    result.sensitive = true;
  }

  return result;
};
