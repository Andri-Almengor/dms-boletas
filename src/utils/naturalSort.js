const NATURAL_COLLATOR = new Intl.Collator('es', {
  numeric: true,
  sensitivity: 'base',
});

export function compareNatural(left = '', right = '') {
  return NATURAL_COLLATOR.compare(String(left ?? ''), String(right ?? ''));
}

// Ordenamiento visual de catálogos: no altera el arreglo original ni sus IDs.
// Los selectores colocan sus opciones especiales (p. ej. «Todos») por separado.
export function sortItemsNaturally(items = [], getLabel = (item) => item?.label ?? item) {
  return [...items].sort((left, right) => compareNatural(getLabel(left), getLabel(right)));
}

export function sortOptionsNaturally(options = []) {
  return sortItemsNaturally(options, (item) => item?.label);
}
