const NATURAL_COLLATOR = new Intl.Collator('es', {
  numeric: true,
  sensitivity: 'base',
});

export function compareNatural(left = '', right = '') {
  return NATURAL_COLLATOR.compare(String(left ?? ''), String(right ?? ''));
}

export function sortOptionsNaturally(options = []) {
  return [...options].sort((left, right) => compareNatural(left?.label, right?.label));
}
