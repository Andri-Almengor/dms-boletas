function compactMacAddress(value = '') {
  return String(value || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase();
}

export function formatMacAddressInput(value = '') {
  const compact = compactMacAddress(value).slice(0, 12);
  if (!compact) return '';
  return compact.match(/.{1,2}/g)?.join(':') || '';
}

export function normalizeMacAddress(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return formatMacAddressInput(raw);
}

export function isValidMacAddress(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const compact = compactMacAddress(raw);
  return compact.length === 12 && /^[A-F0-9]{12}$/.test(compact);
}

export function macAddressError(value = '') {
  return isValidMacAddress(value)
    ? ''
    : 'Use una dirección MAC válida, por ejemplo AA:BB:CC:DD:EE:FF.';
}
