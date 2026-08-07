const VENDOR_ALIASES = Object.freeze([
  ['AXIS', /\baxis(?: communications)?\b/i],
  ['Hanwha Vision', /\bhanwha(?: vision| techwin)?\b|\bwisenet\b|\bsamsung techwin\b/i],
  ['TruVision', /\btru\s*vision\b|\binterlogix\b/i],
  ['Provision-ISR', /\bprovision[\s-]*isr\b/i],
  ['Eagle Eye Networks', /\beagle\s*eye(?: networks)?\b/i],
  ['i-PRO', /\bi[\s-]*pro\b/i],
  ['Hikvision', /\bhikvision\b/i],
  ['Dahua', /\bdahua\b/i],
  ['Bosch', /\bbosch\b/i],
  ['Avigilon', /\bavigilon\b/i],
  ['Uniview', /\buniview\b|\bUNV\b/i],
  ['Vivotek', /\bvivotek\b/i],
  ['Pelco', /\bpelco\b/i],
  ['MOBOTIX', /\bmobotix\b/i],
  ['Reolink', /\breolink\b/i],
]);

const MODEL_FAMILIES = Object.freeze([
  {
    manufacturer: 'TruVision',
    expression: /\b((?:TVB|TVD|TVT|TVP|TVW)-[A-Z0-9][A-Z0-9-]{2,})\b/i,
    family: 'TRUVISION_TV_SERIES',
  },
  {
    manufacturer: 'Hanwha Vision',
    expression: /\b((?:PND|PNV|PNO|PNM|PNB|PNF|XND|XNV|XNO|XNP|XNB|XNF|QND|QNV|QNO|QNP|QNB|QNF|TND|TNV|TNO|TNP|TNB)-[A-Z0-9][A-Z0-9-]{2,})\b/i,
    family: 'HANWHA_WISENET_SERIES',
  },
  {
    manufacturer: 'Provision-ISR',
    expression: /\b((?:DI|DAI|DH|DAH|BSH|BMH|MC|I[2468])-[A-Z0-9][A-Z0-9-]{2,})\b/i,
    family: 'PROVISION_ISR_SERIES',
  },
  {
    manufacturer: 'AXIS',
    expression: /\b(?:AXIS\s+)?([PQMFCATV][0-9][A-Z0-9-]{2,})\b/i,
    family: 'AXIS_SERIES',
  },
  {
    manufacturer: 'i-PRO',
    expression: /\b(WV-[A-Z0-9][A-Z0-9-]{2,})\b/i,
    family: 'IPRO_WV_SERIES',
  },
  {
    manufacturer: 'Eagle Eye Networks',
    expression: /\b(EN-[A-Z0-9][A-Z0-9-]{2,})\b/i,
    family: 'EAGLE_EYE_EN_SERIES',
  },
  {
    manufacturer: 'Hikvision',
    expression: /\b(DS-[A-Z0-9][A-Z0-9-]{3,})\b/i,
    family: 'HIKVISION_DS_SERIES',
  },
  {
    manufacturer: 'Dahua',
    expression: /\b((?:IPC|NVR|DVR|HAC)-[A-Z0-9][A-Z0-9-]{2,})\b/i,
    family: 'DAHUA_SERIES',
  },
]);

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function canonicalManufacturer(value = '') {
  const raw = text(value, 250);
  if (!raw) return '';
  return VENDOR_ALIASES.find(([, expression]) => expression.test(raw))?.[0] || raw;
}

function modelFamily(material = '') {
  const source = text(material, 12_000);
  for (const profile of MODEL_FAMILIES) {
    const match = source.match(profile.expression);
    if (match?.[1]) {
      return {
        manufacturer: profile.manufacturer,
        model: text(match[1].toUpperCase(), 180),
        family: profile.family,
      };
    }
  }
  return null;
}

export function identifyCameraVendorProfile({ manufacturer = '', model = '', material = '' } = {}) {
  const explicitManufacturer = canonicalManufacturer(manufacturer);
  const combined = [manufacturer, model, material].filter(Boolean).join(' ');
  const explicitAlias = VENDOR_ALIASES.find(([, expression]) => expression.test(combined));
  const family = modelFamily([model, material].filter(Boolean).join(' '));

  // La marca entregada explícitamente por ONVIF tiene prioridad. Una familia de modelo
  // solo completa la marca cuando la cámara no la publicó, evitando sobrescribir datos reales.
  const resolvedManufacturer = explicitManufacturer
    || explicitAlias?.[0]
    || family?.manufacturer
    || '';

  return {
    manufacturer: resolvedManufacturer,
    model: family?.model || text(model, 180),
    family: family?.family || '',
    evidence: explicitManufacturer || explicitAlias
      ? 'EXPLICIT_VENDOR'
      : family
        ? 'MODEL_FAMILY'
        : '',
  };
}

export const CAMERA_VENDOR_MODEL_FAMILIES = MODEL_FAMILIES.map(({ manufacturer, family }) => ({
  manufacturer,
  family,
}));
