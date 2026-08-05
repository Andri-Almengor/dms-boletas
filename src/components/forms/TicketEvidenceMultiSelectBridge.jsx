import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import { prepareEvidenceFiles } from '../../utils/evidenceMedia';

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ticketIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/boletas\/([^/]+)\/?$/i);
  if (!match) return '';
  try {
    const value = decodeURIComponent(match[1] || '');
    if (['pendientes', 'finalizadas', 'nueva'].includes(value.toLowerCase())) return '';
    return value;
  } catch {
    return '';
  }
}

function evidenceName(item, index, total, baseName) {
  const file = item?.file || item;
  const cleanBase = String(baseName || '').trim();
  if (!cleanBase) return file.name;
  if (total === 1) return cleanBase;
  return `${cleanBase} ${index + 1}`;
}

function fileSizeLabel(size) {
  const bytes = Number(size || 0);
  if (bytes >= 1024 * 1024) return `${Math.max(0.1, bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function TicketEvidenceMultiSelectBridge() {
  const { pathname } = useLocation();
  const { sessionToken } = useAuth();
  const selectedFilesRef = useRef([]);
  const activeInputRef = useRef(null);
  const activeFormRef = useRef(null);
  const activeUploadButtonRef = useRef(null);
  const activeSelectButtonRef = useRef(null);
  const inputHandlerRef = useRef(null);
  const submitHandlerRef = useRef(null);
  const uploadButtonHandlerRef = useRef(null);
  const selectButtonHandlerRef = useRef(null);

  useEffect(() => {
    const boletaUid = ticketIdFromPath(pathname);
    if (!boletaUid || !sessionToken) return undefined;

    let disposed = false;
    let uploading = false;
    let validating = false;

    function summaryNode(form) {
      let node = form.querySelector('[data-dms-multi-evidence-summary]');
      if (!node) {
        node = document.createElement('div');
        node.className = 'ticket-detail-selected-files';
        node.dataset.dmsMultiEvidenceSummary = 'true';
        const actions = form.querySelector('.ticket-detail-capture-actions');
        actions?.insertAdjacentElement('afterend', node);
      }
      return node;
    }

    function sourceFileInput(form) {
      return [...form.querySelectorAll('input[type="file"]')]
        .find((input) => !input.hasAttribute('capture') && !input.dataset.dmsMultiEvidenceInput);
    }

    function multiFileInput(form) {
      let input = form.querySelector('[data-dms-multi-evidence-input]');
      if (!input) {
        const sourceInput = sourceFileInput(form);
        const actions = form.querySelector('.ticket-detail-capture-actions');
        input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.className = 'ticket-detail-hidden-input';
        input.accept = sourceInput?.accept || 'image/*,video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm,.pdf,.doc,.docx';
        input.dataset.dmsMultiEvidenceInput = 'true';
        actions?.appendChild(input);
      }
      return input;
    }

    function selectMultipleButton(form) {
      let button = form.querySelector('[data-dms-multi-evidence-select]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button--secondary ticket-detail-multi-select-button';
        button.dataset.dmsMultiEvidenceSelect = 'true';
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">photo_library</span><span>Seleccionar varios archivos</span>';
        form.querySelector('.ticket-detail-capture-actions')?.appendChild(button);
      }
      return button;
    }

    function uploadButton(form) {
      let button = form.querySelector('[data-dms-multi-evidence-upload]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button--primary ticket-detail-multi-upload-button';
        button.dataset.dmsMultiEvidenceUpload = 'true';
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span><span>Agregar evidencias seleccionadas</span>';
        button.hidden = true;
        form.appendChild(button);
      }
      return button;
    }

    function originalSubmitButton(form) {
      if (!form) return null;
      return [...form.querySelectorAll('button')].find((button) => (
        !button.dataset.dmsMultiEvidenceUpload
        && !button.dataset.dmsMultiEvidenceSelect
        && (button.type === 'submit' || !button.getAttribute('type'))
      ));
    }

    function syncSubmissionMode(form) {
      const hasMultipleSelection = selectedFilesRef.current.length > 0;
      const originalSubmit = originalSubmitButton(form);
      const multiUpload = uploadButton(form);
      if (originalSubmit) originalSubmit.hidden = hasMultipleSelection;
      multiUpload.hidden = !hasMultipleSelection;
      multiUpload.disabled = !hasMultipleSelection || uploading || validating;
    }

    function renderSelection(form, status = '', tone = '') {
      const node = summaryNode(form);
      const items = selectedFilesRef.current;
      node.replaceChildren();

      if (!items.length && !status) {
        node.hidden = true;
        delete node.dataset.tone;
        return;
      }

      node.hidden = false;
      if (tone) node.dataset.tone = tone;
      else delete node.dataset.tone;

      const header = document.createElement('div');
      header.className = 'ticket-detail-selected-files__header';

      const title = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = items.length
        ? `${items.length} ${items.length === 1 ? 'archivo seleccionado' : 'archivos seleccionados'}`
        : 'No se pudieron preparar los archivos';
      const small = document.createElement('small');
      small.textContent = status || 'Se validarán y cargarán en orden, sin reemplazar las evidencias existentes.';
      title.append(strong, small);

      if (items.length) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'button button--ghost button--compact';
        clear.textContent = 'Quitar selección';
        clear.disabled = uploading || validating;
        clear.addEventListener('click', () => {
          if (uploading || validating) return;
          selectedFilesRef.current = [];
          if (activeInputRef.current) activeInputRef.current.value = '';
          renderSelection(form);
          syncSubmissionMode(form);
        }, { once: true });
        header.append(title, clear);
      } else {
        header.append(title);
      }
      node.appendChild(header);

      if (!items.length) return;

      const list = document.createElement('ul');
      items.slice(0, 8).forEach((item) => {
        const file = item.file || item;
        const row = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = file.name;
        const metadata = document.createElement('small');
        const duration = item.mediaType === 'video' ? ` · ${Math.ceil(Number(item.durationSeconds || 0))} s` : '';
        metadata.textContent = `${fileSizeLabel(item.size || file.size)}${duration}`;
        row.append(name, metadata);
        list.appendChild(row);
      });
      if (items.length > 8) {
        const remaining = document.createElement('li');
        remaining.className = 'is-more';
        remaining.textContent = `Y ${items.length - 8} archivo(s) más`;
        list.appendChild(remaining);
      }
      node.appendChild(list);
    }

    async function uploadSelected() {
      if (uploading || validating) return;
      const form = activeFormRef.current;
      const items = [...selectedFilesRef.current];
      if (!form || !items.length) return;

      const controls = [...form.querySelectorAll('input.form-control')];
      const baseName = controls[0]?.value || '';
      const note = controls[1]?.value || '';
      const button = uploadButton(form);
      let uploadedCount = 0;

      uploading = true;
      syncSubmissionMode(form);
      form.querySelectorAll('.ticket-detail-capture-actions .button').forEach((item) => {
        item.disabled = true;
      });

      try {
        for (let index = 0; index < items.length; index += 1) {
          const prepared = items[index];
          const file = prepared.file;
          button.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">progress_activity</span><span>Cargando ${index + 1} de ${items.length}...</span>`;
          renderSelection(form, `Cargando ${index + 1} de ${items.length}...`, 'progress');
          await requestAvailable(MODULE_ROUTES.tickets.evidenceUpload, {
            boletaUid,
            nombre: evidenceName(prepared, index, items.length, baseName),
            nota: note,
            fileName: file.name,
            mimeType: prepared.mimeType,
            mediaType: prepared.mediaType,
            durationSeconds: Number(prepared.durationSeconds || 0),
            size: Number(prepared.size || file.size || 0),
            base64: await fileToBase64(file),
          }, sessionToken);
          uploadedCount = index + 1;
        }

        renderSelection(form, 'Todas las evidencias se cargaron correctamente.', 'success');
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Evidencias cargadas</span>';
        selectedFilesRef.current = [];
        if (activeInputRef.current) activeInputRef.current.value = '';
        window.setTimeout(() => window.location.reload(), 450);
      } catch (error) {
        uploading = false;
        selectedFilesRef.current = items.slice(uploadedCount);
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">refresh</span><span>Reintentar carga pendiente</span>';
        form.querySelectorAll('.ticket-detail-capture-actions .button').forEach((item) => {
          item.disabled = false;
        });
        const prefix = uploadedCount
          ? `${uploadedCount} evidencia(s) se cargaron. Quedan ${selectedFilesRef.current.length}. `
          : '';
        renderSelection(form, `${prefix}${error?.message || 'No se pudieron cargar todas las evidencias.'}`, 'error');
        syncSubmissionMode(form);
      }
    }

    function detachCurrentListeners() {
      if (activeInputRef.current && inputHandlerRef.current) {
        activeInputRef.current.removeEventListener('change', inputHandlerRef.current);
      }
      if (activeFormRef.current && submitHandlerRef.current) {
        activeFormRef.current.removeEventListener('submit', submitHandlerRef.current, true);
      }
      if (activeUploadButtonRef.current && uploadButtonHandlerRef.current) {
        activeUploadButtonRef.current.removeEventListener('click', uploadButtonHandlerRef.current);
      }
      if (activeSelectButtonRef.current && selectButtonHandlerRef.current) {
        activeSelectButtonRef.current.removeEventListener('click', selectButtonHandlerRef.current);
      }
      activeInputRef.current = null;
      activeFormRef.current = null;
      activeUploadButtonRef.current = null;
      activeSelectButtonRef.current = null;
      inputHandlerRef.current = null;
      submitHandlerRef.current = null;
      uploadButtonHandlerRef.current = null;
      selectButtonHandlerRef.current = null;
    }

    function enhance() {
      if (disposed) return;
      const form = document.querySelector('.ticket-detail-evidence-form');
      if (!form) return;

      const input = multiFileInput(form);
      const selectButton = selectMultipleButton(form);
      const button = uploadButton(form);
      renderSelection(form);
      syncSubmissionMode(form);

      if (
        activeInputRef.current === input
        && activeFormRef.current === form
        && activeUploadButtonRef.current === button
        && activeSelectButtonRef.current === selectButton
      ) return;

      detachCurrentListeners();

      const onInputChange = async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) {
          selectedFilesRef.current = [];
          renderSelection(form);
          syncSubmissionMode(form);
          return;
        }

        validating = true;
        selectedFilesRef.current = [];
        selectButton.disabled = true;
        renderSelection(form, `Validando ${files.length} archivo(s)...`, 'progress');
        syncSubmissionMode(form);
        try {
          selectedFilesRef.current = await prepareEvidenceFiles(files, { allowDocuments: true });
          renderSelection(form);
        } catch (error) {
          selectedFilesRef.current = [];
          input.value = '';
          renderSelection(form, error?.message || 'No se pudieron validar los archivos seleccionados.', 'error');
        } finally {
          validating = false;
          selectButton.disabled = false;
          syncSubmissionMode(form);
        }
      };

      const onSubmit = (event) => {
        if (!selectedFilesRef.current.length) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        uploadSelected();
      };

      const onUploadClick = () => uploadSelected();
      const onSelectClick = () => input.click();

      input.addEventListener('change', onInputChange);
      form.addEventListener('submit', onSubmit, true);
      button.addEventListener('click', onUploadClick);
      selectButton.addEventListener('click', onSelectClick);

      activeInputRef.current = input;
      activeFormRef.current = form;
      activeUploadButtonRef.current = button;
      activeSelectButtonRef.current = selectButton;
      inputHandlerRef.current = onInputChange;
      submitHandlerRef.current = onSubmit;
      uploadButtonHandlerRef.current = onUploadClick;
      selectButtonHandlerRef.current = onSelectClick;
    }

    const observer = new MutationObserver(() => {
      const form = document.querySelector('.ticket-detail-evidence-form');
      if (!form) return;
      if (
        form !== activeFormRef.current
        || !form.querySelector('[data-dms-multi-evidence-input]')
        || !form.querySelector('[data-dms-multi-evidence-select]')
        || !form.querySelector('[data-dms-multi-evidence-summary]')
        || !form.querySelector('[data-dms-multi-evidence-upload]')
      ) enhance();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    enhance();

    return () => {
      disposed = true;
      observer.disconnect();
      const form = activeFormRef.current || document.querySelector('.ticket-detail-evidence-form');
      const originalSubmit = originalSubmitButton(form);
      if (originalSubmit) originalSubmit.hidden = false;
      detachCurrentListeners();
      form?.querySelector('[data-dms-multi-evidence-input]')?.remove();
      form?.querySelector('[data-dms-multi-evidence-select]')?.remove();
      form?.querySelector('[data-dms-multi-evidence-summary]')?.remove();
      form?.querySelector('[data-dms-multi-evidence-upload]')?.remove();
      selectedFilesRef.current = [];
    };
  }, [pathname, sessionToken]);

  return null;
}
