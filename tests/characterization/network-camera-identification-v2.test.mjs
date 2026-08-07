import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseOnvifDeviceInformationXml,
  parseOnvifNetworkInterfacesXml,
} from '../../gateway-agent/src/adapters/network-camera-identification.js';
import { createAdapterFromEnvironment } from '../../gateway-agent/src/adapters/adapter-factory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const info = parseOnvifDeviceInformationXml(`
  <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
    <s:Body>
      <tds:GetDeviceInformationResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
        <tds:Manufacturer>AXIS</tds:Manufacturer>
        <tds:Model>AXIS P3265-LV</tds:Model>
        <tds:FirmwareVersion>12.1.3</tds:FirmwareVersion>
        <tds:SerialNumber>ABC123</tds:SerialNumber>
        <tds:HardwareId>P3265</tds:HardwareId>
      </tds:GetDeviceInformationResponse>
    </s:Body>
  </s:Envelope>
`);
assert.equal(info.found, true);
assert.equal(info.manufacturer, 'AXIS');
assert.equal(info.model, 'AXIS P3265-LV');
assert.equal(info.firmwareVersion, '12.1.3');
assert.equal(info.serialNumber, 'ABC123');
assert.equal(info.hardwareId, 'P3265');

const macs = parseOnvifNetworkInterfacesXml(`
  <tds:GetNetworkInterfacesResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
    <tds:NetworkInterfaces token="eth0"><tt:Info><tt:HwAddress>AC-CC-8E-12-34-56</tt:HwAddress></tt:Info></tds:NetworkInterfaces>
    <tds:NetworkInterfaces token="eth1"><tt:Info><tt:HwAddress>00:40:8C:AA:BB:CC</tt:HwAddress></tt:Info></tds:NetworkInterfaces>
  </tds:GetNetworkInterfacesResponse>
`);
assert.deepEqual(macs, ['AC:CC:8E:12:34:56', '00:40:8C:AA:BB:CC']);

const adapter = createAdapterFromEnvironment({
  DMS_GATEWAY_ADAPTER: 'network',
  DMS_NETWORK_TARGETS: '192.168.100.204',
  DMS_NETWORK_IDENTIFICATION_ENABLED: 'true',
  DMS_NETWORK_ONVIF_UNICAST_ENABLED: 'true',
});
assert.equal(adapter.name, 'NETWORK_DISCOVERY');
assert.equal(adapter.capabilities().identificationLayer, 2);
assert.equal(adapter.capabilities().cameraIdentification, true);
assert.equal(adapter.capabilities().onvifUnicastDiscovery, true);
assert.equal(adapter.capabilities().onvifDeviceInformation, true);
assert.equal(adapter.capabilities().onvifNetworkInterfaces, true);

const helperSource = fs.readFileSync(path.join(root, 'gateway-agent/src/adapters/network-camera-identification.js'), 'utf8');
assert.match(helperSource, /GetDeviceInformation/);
assert.match(helperSource, /GetNetworkInterfaces/);
assert.match(helperSource, /ONVIF_UNICAST_DISCOVERY/);
assert.doesNotMatch(helperSource, /admin\/admin|admin:admin|password\s*=|Authorization:\s*Basic/i);

const factorySource = fs.readFileSync(path.join(root, 'gateway-agent/src/adapters/adapter-factory.js'), 'utf8');
assert.match(factorySource, /IdentifiedNetworkDiscoveryAdapter/);

const envExample = fs.readFileSync(path.join(root, 'gateway-agent/.env.example'), 'utf8');
assert.match(envExample, /DMS_NETWORK_IDENTIFICATION_ENABLED=true/);
assert.match(envExample, /DMS_NETWORK_ONVIF_UNICAST_ENABLED=true/);

console.log('Network camera identification v2 characterization tests passed.');
