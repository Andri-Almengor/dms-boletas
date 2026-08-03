const GROUP_SELECTOR = '.maintenance-location-work-group';
const FEEDBACK_CLASS = 'maintenance-location-device-created-feedback';
const OFFLINE_PREVIEW_CLASS = 'maintenance-offline-device-preview';
const MAX_FIND_ATTEMPTS = 30;
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
    const options = Array.from(select.options || []);
    const defaultValue = options.some((option) => option.value === 'TODAS')
      ? 'TODAS'
      : options.some((option) => option.value === 'TODOS') ? 'TODOS' : '';
    if (!defaultValue || select.value === defaultValue) return;
    setNativeValue(select, defaultValue);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const allCategories = document.querySelector('.maintenance-device-category-chips button:first-child');
  if (allCategories && !allCategories.classList.contains('is-active')) allCategories.click();
}

function findLocationGroup(locationName) {
  const wanted = normalized(locationName);
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

function hasActualDevice(group, detail) {
  const wantedId = String(detail.deviceId || '').trim();
  if (wantedId && group.textContent.includes(`ID: ${wantedId}`)) return true;
  const wantedName = normalized(detail.deviceName);
  return Array.from(group.querySelectorAll('strong')).some((item) => {
    if (item.closest(`.${FEEDBACK_CLASS}, .${OFFLINE_PREVIEW_CLASS}`)) return false;
    return normalized(item.textContent) === wantedName;
  });
}

function renderOfflinePreview(group, detail) {
  if (!detail.offlinePending || hasActualDevice(group, detail)) return;
  const duplicate = Array.from(group.querySelectorAll(`.${OFFLINE_PREVIEW_CLASS}`)).some((item) => (
    String(item.dataset.deviceId || '') === String(detail.deviceId || '')
  ));
  if (duplicate) return;

  const content = group.querySelector('.maintenance-location-work-group__content');
  if (!content) {
    window.setTimeout(() => renderOfflinePreview(group, detail), FIND_DELAY_MS);
    return;
  }

  const preview = document.createElement('article');
  preview.className = OFFLINE_PREVIEW_CLASS;
  preview.dataset.deviceId = String(detail.deviceId || '');

  const icon = document.createElement('span');
  icon.className = `${OFFLINE_PREVIEW_CLASS}__icon`;
  icon.appendChild(makeIcon('devices_other'));

  const body = document.createElement('div');
  body.className = `${OFFLINE_PREVIEW_CLASS}__body`;
  const name = document.createElement('strong');
  name.textContent = String(detail.deviceName || 'Nuevo dispositivo');
  const meta = document.createElement('span');
  meta.textContent = [detail.category, detail.model, detail.serial].filter(Boolean).join(' · ') || 'Dispositivo del mantenimiento';
  const status = document.createElement('small');
  status.className = `${OFFLINE_PREVIEW_CLASS}__status`;
  status.append(makeIcon('cloud_off'), document.createTextNode('Guardado offline · pendiente de sincronizar'));
  body.append(name, meta, status);

  const edit = document.createElement('a');
  edit.className = `${OFFLINE_PREVIEW_CLASS}__edit`;
  edit.href = `/mantenimientos/${encodeURIComponent(detail.maintenanceId || '')}/editar?directDevice=1&device=${encodeURIComponent(detail.deviceId || '')}`;
  edit.append(makeIcon('edit'), document.createTextNode('Editar dispositivo y evidencias'));

  preview.append(icon, body, edit);
  content.insertAdjacentElement('afterbegin', preview);
}

export function maintenanceDeviceCreatedMessage(detail = {}) {
  const deviceName = String(detail.deviceName || '').trim() || 'El dispositivo';
  const locationName = String(detail.locationName || '').trim() || 'la ubicación seleccionada';
  return {
    title: detail.offlinePending ? 'Dispositivo guardado offline' : 'Dispositivo agregado',
    description: detail.offlinePending
      ? `${deviceName} se agregó a “${locationName}”. Ya puede verlo y editarlo en esta ubicación. Se sincronizará al recuperar conexión.`
      : `${deviceName} se agregó a “${locationName}”.`,
  };
}

function renderFeedback(group, detail) {
  document.querySelectorAll(`.${FEEDBACK_CLASS}`).forEach((item) => item.remove());
  document.querySelectorAll(`${GROUP_SELECTOR}.has-device-created-feedback`).forEach((item) => item.classList.remove('has-device-created-feedback'));

  if (!group.classList.contains('is-open')) group.querySelector('.maintenance-location-work-group__toggle')?.click();

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
  window.setTimeout(() => renderOfflinePreview(group, detail), FIND_DELAY_MS);
  window.requestAnimationFrame(() => group.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  window.setTimeout(() => {
    feedback.remove();
    group.classList.remove('has-device-created-feedback');
  }, DISPLAY_MS);
}

export function showMaintenanceDeviceCreatedFeedback(detail = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const locationName = String(detail.locationName || '').trim();
  if (!locationName) return;
  resetInventoryFilters();
  let attempts = 0;

  const reveal = () => {
    const group = findLocationGroup(locationName);
    if (group) return renderFeedback(group, detail);
    attempts += 1;
    if (attempts < MAX_FIND_ATTEMPTS) window.setTimeout(reveal, FIND_DELAY_MS);
  };

  window.setTimeout(reveal, FIND_DELAY_MS);
}
