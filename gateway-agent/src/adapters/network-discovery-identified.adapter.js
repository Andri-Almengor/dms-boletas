import { ConfigurableNetworkDiscoveryAdapter } from './network-discovery-configurable.adapter.js';
import { identifyNetworkCamera } from './network-camera-identification.js';

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function envBoolean(value, fallback = true) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  if (/^(1|true|yes|y|si|sí|on)$/i.test(normalized)) return true;
  if (/^(0|false|no|n|off)$/i.test(normalized)) return false;
  return fallback;
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, consume));
  return results;
}

function genericDetectedName(value, ip) {
  const normalized = text(value, 250).toLowerCase();
  return !normalized || normalized === `cámara detectada ${String(ip).toLowerCase()}`;
}

function enrichDevice(device, identification) {
  if (!identification) return device;
  const metadata = device.metadata || {};
  const onvif = identification.onvif || {};
  const detectedName = genericDetectedName(device.name, device.ipAddress) && onvif.name
    ? onvif.name
    : device.name;
  const macAddress = text(device.macAddress || identification.macAddress, 80).toUpperCase();
  const manufacturer = text(identification.manufacturer || device.manufacturer, 160);
  const model = text(identification.model || device.model, 160);
  const confidence = identification.confidence === 'HIGH'
    ? 'HIGH'
    : metadata.discoveryConfidence || identification.confidence || 'MEDIUM';

  return {
    ...device,
    name: detectedName,
    macAddress,
    manufacturer,
    model,
    capabilities: {
      ...(device.capabilities || {}),
      identificationLayer: 2,
      onvifIdentified: Boolean(onvif.confirmed),
      onvifDeviceInformation: Boolean(onvif.manufacturer || onvif.model || onvif.firmwareVersion || onvif.serialNumber),
      macFromOnvif: Boolean(!device.macAddress && identification.macAddress),
    },
    metadata: {
      ...metadata,
      discoveryConfidence: confidence,
      identificationLayer: 2,
      identificationEvidence: identification.evidence || [],
      onvifConfirmed: Boolean(onvif.confirmed),
      onvifAuthRequired: Boolean(onvif.authRequired),
      onvifEndpoint: text(onvif.endpoint, 500),
      onvifUuid: text(onvif.uuid, 250),
      onvifName: text(onvif.name, 200),
      onvifHardware: text(onvif.hardware, 200),
      onvifLocation: text(onvif.location || metadata.onvifLocation, 250),
      firmwareVersion: text(onvif.firmwareVersion, 200),
      serialNumber: text(onvif.serialNumber, 200),
      hardwareId: text(onvif.hardwareId, 200),
      onvifMacAddresses: Array.isArray(onvif.macAddresses) ? onvif.macAddresses.slice(0, 8) : [],
      httpFingerprint: identification.web ? {
        manufacturer: text(identification.web.manufacturer, 160),
        model: text(identification.web.model, 160),
        title: text(identification.web.title, 200),
        generator: text(identification.web.generator, 200),
        server: text(identification.web.server, 200),
        statusCode: Number(identification.web.statusCode || 0),
      } : null,
    },
  };
}

export class IdentifiedNetworkDiscoveryAdapter extends ConfigurableNetworkDiscoveryAdapter {
  constructor({ env = process.env } = {}) {
    super({ env });
    this.identificationEnabled = envBoolean(env.DMS_NETWORK_IDENTIFICATION_ENABLED, true);
    this.unicastOnvifEnabled = envBoolean(env.DMS_NETWORK_ONVIF_UNICAST_ENABLED, true);
    this.identificationTimeoutMs = boundedNumber(env.DMS_NETWORK_IDENTIFICATION_TIMEOUT_MS, 1_200, 300, 5_000);
    this.unicastOnvifTimeoutMs = boundedNumber(env.DMS_NETWORK_ONVIF_UNICAST_TIMEOUT_MS, 700, 250, 3_000);
    this.identificationConcurrency = boundedNumber(env.DMS_NETWORK_IDENTIFICATION_CONCURRENCY, 12, 1, 32);
  }

  capabilities() {
    return {
      ...super.capabilities(),
      cameraIdentification: this.identificationEnabled,
      identificationLayer: this.identificationEnabled ? 2 : 1,
      onvifUnicastDiscovery: this.identificationEnabled && this.unicastOnvifEnabled,
      onvifDeviceInformation: this.identificationEnabled,
      onvifNetworkInterfaces: this.identificationEnabled,
    };
  }

  async listDevices() {
    const devices = await super.listDevices();
    if (!this.identificationEnabled || !devices.length) return devices;

    return mapLimit(devices, this.identificationConcurrency, async (device) => {
      try {
        const identification = await identifyNetworkCamera(device, {
          timeoutMs: this.identificationTimeoutMs,
          discoveryTimeoutMs: this.unicastOnvifTimeoutMs,
          useUnicastDiscovery: this.unicastOnvifEnabled,
        });
        return enrichDevice(device, identification);
      } catch {
        // La segunda capa es enriquecimiento. Nunca debe descartar una cámara
        // que la primera capa ya detectó correctamente.
        return device;
      }
    });
  }
}
