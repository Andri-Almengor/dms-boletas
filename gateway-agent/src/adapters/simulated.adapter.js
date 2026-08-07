function boundedCount(value) {
  const count = Number(value || 3);
  return Number.isFinite(count) ? Math.min(25, Math.max(1, Math.floor(count))) : 3;
}

function macFor(index) {
  return `02:44:4D:53:00:${String(index + 1).padStart(2, '0')}`;
}

export class SimulatedAdapter {
  constructor({ deviceCount = 3 } = {}) {
    this.name = 'SIMULATED';
    this.deviceCount = boundedCount(deviceCount);
  }

  capabilities() {
    return {
      inventory: true,
      heartbeat: true,
      commands: ['PING', 'INVENTORY_SYNC'],
      snapshots: false,
      liveVideo: false,
      sourceSystems: ['SIMULATED'],
    };
  }

  async listDevices() {
    const now = new Date().toISOString();
    return Array.from({ length: this.deviceCount }, (_, index) => ({
      externalId: `sim-camera-${String(index + 1).padStart(3, '0')}`,
      sourceSystem: 'SIMULATED',
      type: 'CAMERA',
      name: `Cámara simulada ${index + 1}`,
      ipAddress: `192.168.250.${index + 10}`,
      macAddress: macFor(index),
      manufacturer: 'DMS Simulator',
      model: 'Virtual Camera 1.0',
      status: 'ONLINE',
      lastSeenAt: now,
      capabilities: {
        inventory: true,
        status: true,
        snapshot: false,
      },
      metadata: {
        simulated: true,
        locationHint: `Zona de demostración ${index + 1}`,
      },
    }));
  }

  async execute(command) {
    const type = String(command?.Tipo || command?.type || '').toUpperCase();
    if (type === 'PING') {
      return {
        pong: true,
        adapter: this.name,
        receivedAt: new Date().toISOString(),
      };
    }
    if (type === 'INVENTORY_SYNC') {
      const devices = await this.listDevices();
      return { inventoryRequested: true, deviceCount: devices.length, devices };
    }
    const error = new Error(`El adaptador simulado no admite el comando ${type || 'desconocido'}.`);
    error.code = 'UNSUPPORTED_COMMAND';
    throw error;
  }
}
