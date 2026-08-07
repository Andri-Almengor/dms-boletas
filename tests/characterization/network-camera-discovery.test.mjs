import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  candidateToInventoryItem,
  hostsForCidrs,
  isPrivateIpv4,
  parseOnvifDiscoveryXml,
  parsePrivateCidr,
} from '../../gateway-agent/src/adapters/network-discovery.adapter.js';
import {
  parseNetworkTarget,
  parseNetworkTargets,
} from '../../gateway-agent/src/adapters/network-targets.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el descubrimiento limita el escaneo automático a subredes IPv4 privadas pequeñas', () => {
  assert.equal(isPrivateIpv4('192.168.1.25'), true);
  assert.equal(isPrivateIpv4('10.20.30.40'), true);
  assert.equal(isPrivateIpv4('172.20.1.5'), true);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(parsePrivateCidr('192.168.50.0/24')?.hosts, 254);
  assert.equal(parsePrivateCidr('10.0.0.0/16'), null);
  assert.equal(parsePrivateCidr('203.0.113.0/24'), null);
  assert.deepEqual(hostsForCidrs(['192.168.50.0/30']), ['192.168.50.1', '192.168.50.2']);
});

test('los objetivos configurables aceptan CIDR, IP y rangos completos o abreviados', () => {
  const cidr = parseNetworkTarget('192.168.4.0/24');
  assert.equal(cidr.kind, 'CIDR');
  assert.equal(cidr.hostCount, 254);
  assert.equal(cidr.spec, '192.168.4.0/24');

  const fullRange = parseNetworkTarget('192.168.4.100-192.168.4.200');
  assert.equal(fullRange.kind, 'RANGE');
  assert.equal(fullRange.hostCount, 101);
  assert.equal(fullRange.spec, '192.168.4.100-192.168.4.200');

  const shortRange = parseNetworkTarget('192.168.4.100-200');
  assert.equal(shortRange.spec, '192.168.4.100-192.168.4.200');

  const slashShortcut = parseNetworkTarget('192.168.4.100/200');
  assert.equal(slashShortcut.spec, '192.168.4.100-192.168.4.200');

  const single = parseNetworkTarget('192.168.96.12');
  assert.equal(single.kind, 'IP');
  assert.equal(single.hostCount, 1);
});

test('los destinos públicos requieren habilitación local explícita y quedan acotados', () => {
  assert.throws(
    () => parseNetworkTargets('201.1.2.10', { allowPublic: false, maxHosts: 1024 }),
    /DMS_NETWORK_ALLOW_PUBLIC_TARGETS=true/,
  );

  const allowed = parseNetworkTargets('201.1.2.10,192.168.4.100/102', {
    allowPublic: true,
    maxHosts: 1024,
  });
  assert.deepEqual(allowed.hosts, ['201.1.2.10', '192.168.4.100', '192.168.4.101', '192.168.4.102']);

  assert.throws(
    () => parseNetworkTargets('201.1.0.0/23', { allowPublic: true, maxHosts: 1024 }),
    /rango inválido|máximo/i,
  );
});

test('el parser ONVIF usa UUID y scopes sin autenticarse contra la cámara', () => {
  const xml = `<?xml version="1.0"?>
    <Envelope xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
      <Body><d:ProbeMatches><d:ProbeMatch>
        <a:EndpointReference><a:Address>urn:uuid:12345678-1234-1234-1234-123456789abc</a:Address></a:EndpointReference>
        <d:Types>dn:NetworkVideoTransmitter</d:Types>
        <d:Scopes>onvif://www.onvif.org/name/Entrada_Principal onvif://www.onvif.org/hardware/AXIS_P3265-LV onvif://www.onvif.org/location/Edificio_A</d:Scopes>
        <d:XAddrs>http://192.168.50.20/onvif/device_service</d:XAddrs>
      </d:ProbeMatch></d:ProbeMatches></Body>
    </Envelope>`;
  const parsed = parseOnvifDiscoveryXml(xml);
  assert.equal(parsed.uuid, '12345678-1234-1234-1234-123456789abc');
  assert.equal(parsed.name, 'Entrada Principal');
  assert.equal(parsed.hardware, 'AXIS P3265-LV');
  assert.equal(parsed.location, 'Edificio A');
  assert.deepEqual(parsed.ips, ['192.168.50.20']);
});

test('la cámara descubierta usa identidad estable y expone solo metadatos técnicos permitidos', () => {
  const candidate = {
    ip: '192.168.50.20',
    openPorts: new Set([80, 554]),
    methods: new Set(['ONVIF_WS_DISCOVERY', 'TCP_554']),
    onvif: {
      uuid: '12345678-1234-1234-1234-123456789abc',
      name: 'Entrada Principal',
      hardware: 'AXIS P3265-LV',
      location: 'Edificio A',
      types: ['dn:NetworkVideoTransmitter'],
    },
    http: { server: 'AXIS', title: 'AXIS Camera', realm: '' },
    rtsp: { server: 'GStreamer RTSP server', statusCode: 200 },
  };
  const item = candidateToInventoryItem(candidate, 'AA:BB:CC:DD:EE:FF', '2026-08-07T12:00:00.000Z');
  assert.equal(item.externalId, 'onvif:12345678-1234-1234-1234-123456789abc');
  assert.equal(item.sourceSystem, 'NETWORK_DISCOVERY');
  assert.equal(item.type, 'CAMERA');
  assert.equal(item.name, 'Entrada Principal');
  assert.equal(item.manufacturer, 'AXIS');
  assert.equal(item.status, 'ONLINE');
  assert.equal(item.metadata.discoveryConfidence, 'HIGH');
  assert.deepEqual(item.metadata.openPorts, [80, 554]);
  assert.doesNotMatch(JSON.stringify(item), /password|authorization|credential/i);
});

test('el adaptador de red no prueba contraseñas y usa el plan de objetivos configurables', () => {
  const adapter = source('gateway-agent/src/adapters/network-discovery-configurable.adapter.js');
  const targets = source('gateway-agent/src/adapters/network-targets.js');
  const factory = source('gateway-agent/src/adapters/adapter-factory.js');
  const envExample = source('gateway-agent/.env.example');
  const networkDoc = source('gateway-agent/NETWORK_DISCOVERY.md');

  assert.match(adapter, /239\.255\.255\.250/);
  assert.match(adapter, /ONVIF_WS_DISCOVERY/);
  assert.match(adapter, /RTSP_OPTIONS/);
  assert.match(adapter, /DMS_NETWORK_TARGETS/);
  assert.match(adapter, /DMS_NETWORK_ALLOW_PUBLIC_TARGETS/);
  assert.match(targets, /192\.168\.4\.100\/200/);
  assert.doesNotMatch(adapter, /brute|credential stuffing|default password|Authorization:\s*Basic/i);
  assert.match(factory, /ConfigurableNetworkDiscoveryAdapter/);
  assert.match(factory, /network-discovery/);
  assert.match(networkDoc, /DMS_GATEWAY_ADAPTER=network/);
  assert.match(envExample, /DMS_NETWORK_SCAN_PORTS=80,443,554/);
  assert.match(envExample, /DMS_NETWORK_TARGETS=/);
});

test('el nombre operativo se edita por una ruta administrativa y se conserva separado del detectado', () => {
  const route = source('backend/src/routes/integration-gateway.routes.js');
  const service = source('backend/src/services/integration-device-admin.service.js');
  const syncService = source('backend/src/services/integration-gateway.service.js');
  const api = source('src/services/integrationGatewayApi.js');
  const page = source('src/pages/admin/IntegrationsPage.jsx');

  assert.match(route, /\/admin\/devices\/name/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /ACTUALIZAR_NOMBRE_DISPOSITIVO_INTEGRACION/);
  assert.match(service, /NombreOperativo/);
  assert.match(syncService, /NombreOperativo: current\.NombreOperativo \|\| ''/);
  assert.match(api, /updateIntegrationDeviceName/);
  assert.match(page, /Nombre operativo/);
  assert.match(page, /Detectado como:/);
  assert.match(page, /Las próximas sincronizaciones conservarán este nombre operativo/);
});

test('el agente puede resincronizar inventario de red periódicamente sin superponer escaneos', () => {
  const runtime = source('gateway-agent/src/index.js');
  assert.match(runtime, /NETWORK_DISCOVERY/);
  assert.match(runtime, /10 \* 60_000/);
  assert.match(runtime, /inventoryPromise/);
  assert.match(runtime, /DMS_GATEWAY_INVENTORY_SYNC_MS/);
  assert.match(runtime, /Sincronización periódica habilitada/);
});
