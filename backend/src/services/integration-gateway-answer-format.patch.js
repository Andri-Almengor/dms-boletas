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
  return [
    `• Captura de imagen: ${capabilities.snapshot ? 'Sí' : 'No'}`,
    `• PTZ: ${capabilities.ptz ? 'Sí' : 'No'}`,
    `• Zoom continuo: ${capabilities.continuousZoom ? 'Sí' : 'No'}`,
    `• Posición Home: ${capabilities.homePosition ? 'Sí' : 'No'}`,
    `• Reinicio ONVIF: ${capabilities.reboot ? 'Sí' : 'No'}`,
  ];
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
    result.answer = [
      clean(result.answer),
      'Acciones disponibles según la respuesta ONVIF de la cámara:',
      ...capabilityDetails(capabilities),
    ].join('\n');
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
