const SIGNATURES = Object.freeze([
  {
    manufacturer: 'TruVision',
    vendor: /\btru\s*vision\b|\binterlogix\b|\butc\s+fire\s*&?\s*security\b/i,
    models: [/\b(TV[DBTPWNR]-[A-Z0-9-]{3,})\b/i],
  },
  {
    manufacturer: 'Provision-ISR',
    vendor: /\bprovision[-\s]?isr\b|\bprovision\s+isr\b/i,
    models: [/\b(DI-[A-Z0-9-]*IP[A-Z0-9-]*)\b/i],
  },
  {
    manufacturer: 'AXIS',
    vendor: /\baxis(?: communications)?\b/i,
    models: [/\b(AXIS\s+[A-Z][A-Z0-9-]{3,})\b/i],
  },
  {
    manufacturer: 'Hanwha Vision',
    vendor: /\bhanwha(?: vision)?\b|\bwisenet\b|\bsamsung\s+techwin\b/i,
    models: [/\b((?:PND|PNV|PNO|QND|QNV|QNO|XND|XNV|XNO|TND|TNV|TNO)-[A-Z0-9-]{3,})\b/i],
  },
  {
    manufacturer: 'i-PRO',
    vendor: /\bi-?pro\b|\bipro\b/i,
    models: [/\b(WV-[A-Z0-9-]{4,})\b/i],
  },
  {
    manufacturer: 'Eagle Eye Networks',
    vendor: /\beagle\s*eye(?:\s+networks)?\b|\beagleeye\b/i,
    models: [],
  },
  {
    manufacturer: 'Hikvision',
    vendor: /\bhikvision\b|\bhikvision digital technology\b/i,
    models: [/\b(DS-[A-Z0-9-]{4,})\b/i],
  },
  {
    manufacturer: 'Dahua',
    vendor: /\bdahua\b|\bdahua technology\b/i,
    models: [/\b((?:IPC|NVR|DVR|HAC)-[A-Z0-9-]{3,})\b/i],
  },
  { manufacturer: 'Bosch', vendor: /\bbosch\b/i, models: [] },
  { manufacturer: 'Avigilon', vendor: /\bavigilon\b/i, models: [] },
  { manufacturer: 'Uniview', vendor: /\buniview\b|\bUNV\b/i, models: [] },
  { manufacturer: 'Vivotek', vendor: /\bvivotek\b/i, models: [] },
  { manufacturer: 'Pelco', vendor: /\bpelco\b/i, models: [] },
  { manufacturer: 'MOBOTIX', vendor: /\bmobotix\b/i, models: [] },
  { manufacturer: 'Reolink', vendor: /\breolink\b/i, models: [] },
]);

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function cameraSignature(material = '') {
  const source = clean(material, 12_000);
  if (!source) return { manufacturer: '', model: '' };

  for (const signature of SIGNATURES) {
    let matchedModel = '';
    for (const expression of signature.models) {
      const match = source.match(expression);
      if (match?.[1]) {
        matchedModel = clean(match[1], 160);
        break;
      }
    }
    if (matchedModel || signature.vendor.test(source)) {
      return {
        manufacturer: signature.manufacturer,
        model: matchedModel,
      };
    }
  }
  return { manufacturer: '', model: '' };
}

export function cameraManufacturer(material = '') {
  return cameraSignature(material).manufacturer;
}

export const CAMERA_BRAND_SIGNATURES = SIGNATURES;
