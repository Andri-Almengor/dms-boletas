import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

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
  const value = decodeURIComponent(match[1] || '');
  if (['pendientes', 'finalizadas', 'nueva'].includes(value.toLowerCase())) return '';
  return value;
}

function evidenceName(file, index, total, baseName) {
  const cleanBase = String(baseName || '').trim();
  if (!cleanBase) return file.name;
  if (total === 1) return cleanBase;
  return `${cleanBase} ${index + 1}`;
}

export default function TicketEvidenceMultiSelectBridge() {
  const { pathname } = useLocation();
  const { sessionToken } = useAuth();
  const selectedFilesRef = useRef([]);
  const activeInputRef = useRef(null);
  const activeFormRef = useRef(null);
  const inputHandlerRef = useRef(null);
  const submitHandlerRef = useRef(null);

  useEffect(() => {
    const boletaUid = ticketIdFromPath(pathname);
    if (!boletaUid || !sessionToken) return undefined;

    let disposed = false;
    let uploading = false;

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

    function uploadButton(form) {
      let button = form.querySelector('[data-dms-multi-evidence-upload]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button--primary ticket-detail-multi-upload-button';
        button.dataset.dmsMultiEvidenceUpload = 'true';
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span><span>Agregar evidencias seleccionadas</span>';
        form.appendChild(button);
      }
      return button;
    }

    function originalSubmitButton(form) {
      return [...form.querySelectorAll('button')].find((button) => (
        !button.dataset.dmsMultiEvidenceUpload
        && (button.type === 'submit' || !button.getAttribute('type'))
      ));
    }

    function renderSelection(form, status = '', tone = '') {
      const node = summaryNode(form);
      const files = selectedFilesRef.current;
      node.replaceChildren();

      if (!files.length) {
        node.hidden = true;
        return;
      }

      node.hidden = false;
      if (tone) node.dataset.tone = tone;
      else delete node.dataset.tone;

      const header = document.createElement('div');
      header.className = 'ticket-detail-selected-files__header';

      const title = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${files.length} ${files.length === 1 ? 'archivo seleccionado' : 'archivos seleccionados'}`;
      const small = document.createElement('small');
      small.textContent = status || 'Se cargarán todos en una sola acción.';
      title.append(strong, small);

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'button button--ghost button--compact';
      clear.textContent = 'Quitar selección';
      clear.disabled = uploading;
      clear.addEventListener('click', () => {
        if (uploading) return;
        selectedFilesRef.current = [];
        if (activeInputRef.current) activeInputRef.current.value = '';
        renderSelection(form);
        const button = uploadButton(form);
        button.disabled = true;
      }, { once: true });

      header.append(title, clear);
      node.appendChild(header);

      const list = document.createElement('ul');
      files.slice(0, 8).forEach((file) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = file.name;
        const size = document.createElement('small');
        size.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
        item.append(name, size);
        list.appendChild(item);
      });
      if (files.length > 8) {
        const remaining = document.createElement('li');
        remaining.className = 'is-more';
        remaining.textContent = `Y ${files.length - 8} archivo(s) más`;
        list.appendChild(remaining);
      }
      node.appendChild(list);
    }

    async function uploadSelected() {
      if (uploading) return;
      const form = activeFormRef.current;
      const files = [...selectedFilesRef.current];
      if (!form || !files.length) return;

      const controls = [...form.querySelectorAll('input.form-control')];
      const baseName = controls[0]?.value || '';
      const note = controls[1]?.value || '';
      const button = uploadButton(form);

      uploading = true;
      button.disabled = true;
      form.querySelectorAll('.ticket-detail-capture-actions .button').forEach((item) => {
        item.disabled = true;
      });

      try {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          button.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">progress_activity</span><span>Cargando ${index + 1} de ${files.length}...</span>`;
          renderSelection(form, `Cargando ${index + 1} de ${files.length}...`, 'progress');
          await requestAvailable(MODULE_ROUTES.tickets.evidenceUpload, {
            boletaUid,
            nombre: evidenceName(file, index, files.length, baseName),
            nota: note,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            base64: await fileToBase64(file),
          }, sessionToken);
        }

        renderSelection(form, 'Todas las evidencias se cargaron correctamente.', 'success');
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Evidencias cargadas</span>';
        selectedFilesRef.current = [];
        if (activeInputRef.current) activeInputRef.current.value = '';
        window.setTimeout(() => window.location.reload(), 450);
      } catch (error) {
        uploading = false;
        button.disabled = false;
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">refresh</span><span>Reintentar carga</span>';
        form.querySelectorAll('.ticket-detail-capture-actions .button').forEach((item) => {
          item.disabled = false;
        });
        renderSelection(form, error?.message || 'No se pudieron cargar todas las evidencias.', 'error');
      }
    }

    function detachCurrentListeners() {
      if (activeInputRef.current && inputHandlerRef.current) {
        activeInputRef.current.removeEventListener('change', inputHandlerRef.current, true);
      }
      if (activeFormRef.current && submitHandlerRef.current) {
        activeFormRef.current.removeEventListener('submit', submitHandlerRef.current, true);
      }
      activeInputRef.current = null;
      activeFormRef.current = null;
      inputHandlerRef.current = null;
      submitHandlerRef.current = null;
    }

    function enhance() {
      if (disposed) return;
      const form = document.querySelector('.ticket-detail-evidence-form');
      if (!form) return;

      const fileInput = [...form.querySelectorAll('input[type="file"]')]
        .find((input) => !input.hasAttribute('capture'));
      if (!fileInput) return;

      fileInput.multiple = true;
      fileInput.setAttribute('multiple', '');

      const actionButtons = [...form.querySelectorAll('.ticket-detail-capture-actions .button')];
      const selectButton = actionButtons[1];
      if (selectButton && !selectButton.dataset.dmsMultiLabel) {
        selectButton.dataset.dmsMultiLabel = 'true';
        selectButton.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">photo_library</span> Seleccionar varios archivos';
      }

      const originalSubmit = originalSubmitButton(form);
      if (originalSubmit) originalSubmit.hidden = true;

      const button = uploadButton(form);
      button.disabled = !selectedFilesRef.current.length || uploading;
      renderSelection(form);

      if (activeInputRef.current !== fileInput || activeFormRef.current !== form) {
        detachCurrentListeners();

        const onInputChange = (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          selectedFilesRef.current = Array.from(event.target.files || []);
          renderSelection(form);
          uploadButton(form).disabled = !selectedFilesRef.current.length;
        };

        const onSubmit = (event) => {
          if (!selectedFilesRef.current.length) return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          uploadSelected();
        };

        fileInput.addEventListener('change', onInputChange, true);
        form.addEventListener('submit', onSubmit, true);
        activeInputRef.current = fileInput;
        activeFormRef.current = form;
        inputHandlerRef.current = onInputChange;
        submitHandlerRef.current = onSubmit;
      }

      if (!button.dataset.dmsMultiBound) {
        button.dataset.dmsMultiBound = 'true';
        button.addEventListener('click', uploadSelected);
      }
    }

    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    enhance();

    return () => {
      disposed = true;
      observer.disconnect();
      detachCurrentListeners();
      selectedFilesRef.current = [];
    };
  }, [pathname, sessionToken]);

  return null;
}
