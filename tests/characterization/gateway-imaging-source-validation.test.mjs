import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Imaging valida un VideoSource real antes de anunciar o ejecutar Día/Noche', () => {
  const compatibility = source('gateway-agent/src/camera/camera-imaging-compatibility.js');
  const adapter = source('gateway-agent/src/adapters/network-discovery-identified.adapter.js');
  const formatter = source('backend/src/services/integration-gateway-answer-format.patch.js');
  const pkg = source('gateway-agent/package.json');
  const runtime = source('gateway-agent/src/index.js');

  assert.match(compatibility, /GetVideoSources/);
  assert.match(compatibility, /VideoSourceConfiguration/);
  assert.match(compatibility, /GetImagingSettings/);
  assert.match(compatibility, /GetOptions/);
  assert.match(compatibility, /NO_VALID_VIDEO_SOURCE/);
  assert.match(compatibility, /dayMode/);
  assert.match(compatibility, /nightMode/);
  assert.match(compatibility, /dayNightAuto/);
  assert.match(compatibility, /imagingVideoSourceTokenValidated/);
  assert.match(compatibility, /ONVIF_IMAGING_VALIDATED_SOURCE/);
  assert.match(compatibility, /CAMERA_DAYNIGHT_VERIFY_FAILED/);
  assert.match(compatibility, /CAMERA_AUTH_REJECTED/);
  assert.doesNotMatch(compatibility, /passwords|credentialList|tryPasswords/i);

  assert.match(adapter, /executeCameraActionWithValidatedImaging/);
  assert.match(adapter, /cameraImagingValidatedSources:\s*true/);
  assert.match(formatter, /capabilities\.dayMode/);
  assert.match(formatter, /capabilities\.nightMode/);
  assert.match(formatter, /capabilities\.dayNightAuto/);
  assert.doesNotMatch(formatter, /if \(capabilities\.dayNight\) \{[\s\S]*gateway pon modo día[\s\S]*gateway pon modo noche/);
  assert.match(pkg, /camera-imaging-compatibility\.js/);
  assert.match(pkg, /"version": "1\.0\.1"/);
  assert.match(runtime, /const VERSION = '1\.0\.1'/);
});
