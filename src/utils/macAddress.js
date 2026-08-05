export function normalizeMacAddress(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (compact.length !== 12 || !/^[A-F0-9]{12}$/.test(compact)) return raw.toUpperCase();
  return compact.match(/.{2}/g).join(':');
}

export function isValidMacAddress(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return true;
  return /^[A-F0-9]{2}(?::[A-F0-9]{2}){5}$/.test(normalizeMacAddress(raw));
}

export function macAddressError(value = '') {
  return isValidMacAddress(value)
    ? ''
    : 'Use una dirección MAC válida, por ejemplo AA:BB:CC:DD:EE:FF.';
}
