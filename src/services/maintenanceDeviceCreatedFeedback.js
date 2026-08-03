const GROUP_SELECTOR = '.maintenance-location-work-group';
const FEEDBACK_CLASS = 'maintenance-location-device-created-feedback';
const MAX_FIND_ATTEMPTS = 24;
const FIND_DELAY_MS = 100;
const DISPLAY_MS = 8_000;

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function setNativeValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  if (descriptor?.set) descriptor.set.call(element, value);
  else element.value = value;
}

function resetInventoryFilters() {
  const search = document.querySelector('.maintenance-device-toolbar--detail .maintenance-device-search input');
  if (search && search.value) {
    setNativeValue(search, '');
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.querySelectorAll('.maintenance-device-toolbar--detail select').forEach((select) => {
    const defaultValue = Array.from(select.options || []).some((option) => option.value === 'TODAS')
      ? 'TODAS'
      : Array.from(select.options || []).some((option) => option.value === 'TODOS')
        ? 'TODOS'
        : '';
    if (!defaultValue || select.value === defaultValue) return;
    setNativeValue(select, defaultValue);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const allCategories = document.querySelector('.maintenance-device-category-chips button:first-child');
  if (allCategories && !allCategories.classList.contains('is-active')) allCategories.click();
}

function findLocationGroup(locationName) {
  const wanted = normalized(locationName);
  if (!wanted) return null;
  return Array.from(document.querySelectorAll(GROUP_SELECTOR)).find((group) => {
    const label = group.querySelector('.maintenance-location-work-group__text strong')?.textContent;
    return normalized(label) === wanted;
  }) || null;
}

function makeIcon(name) {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name;
  return icon;
}

export function maintenanceDeviceCreatedMessage(detail = {}) {
  const deviceName = String(detail.deviceName || '').trim() || 'El dispositivo';
  const locationName = String(detail.locationName || '').trim() || 'la ubicación seleccionada';
  return {
    title: 'Dispositivo agregado',
    description: `${deviceName} se agregó a “${locationName}”.${detail.offlinePending ? ' Quedó guardado en este equipo y se sincronizará al recuperar conexión.' : ''}`,
  };
}

function renderFeedback(group, detail) {
  document.querySelectorAll(`.${FEEDBACK_CLASS}`).forEach((item) => item.remove());
  document.querySelectorAll(`${GROUP_SELECTOR}.has-device-created-feedback`).forEach((item) => {
    item.classList.remove('has-device-created-feedback');
  });

  const toggle = group.querySelector('.maintenance-location-work-group__toggle');
  if (!group.classList.contains('is-open')) toggle?.click();

  const message = maintenanceDeviceCreatedMessage(detail);
  const feedback = document.createElement('div');
  feedback.className = FEEDBACK_CLASS;
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');

  const icon = document.createElement('span');
  icon.className = 'maintenance-location-device-created-feedback__icon';
  icon.appendChild(makeIcon(detail.offlinePending ? 'cloud_done' : 'check_circle'));

  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = message.title;
  const description = document.createElement('span');
  description.textContent = message.description;
  copy.append(title, description);

  feedback.append(icon, copy);
  group.classList.add('has-device-created-feedback');
  group.querySelector('.maintenance-location-work-group__header')?.insertAdjacentElement('afterend', feedback);

  window.requestAnimationFrame(() => {
    group.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  window.setTimeout(() => {
    feedback.remove();
    group.classList.remove('has-device-created-feedback');
  }, DISPLAY_MS);
}

/**
 * Muestra una confirmación dentro de la ubicación donde se creó el dispositivo.
 * Espera el refresco de React y vuelve a intentarlo para cubrir guardados online
 * y operaciones creadas en la cola offline.
 */
export function showMaintenanceDeviceCreatedFeedback(detail = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const locationName = String(detail.locationName || '').trim();
  if (!locationName) return;

  resetInventoryFilters();
  let attempts = 0;

  const reveal = () => {
    const group = findLocationGroup(locationName);
    if (group) {
      renderFeedback(group, detail);
      return;
    }
    attempts += 1;
    if (attempts < MAX_FIND_ATTEMPTS) window.setTimeout(reveal, FIND_DELAY_MS);
  };

  window.setTimeout(reveal, FIND_DELAY_MS);
}
