import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';

const TOOLS = [
  ['undo', 'undo', 'Deshacer'],
  ['redo', 'redo', 'Rehacer'],
  ['bold', 'format_bold', 'Negrita'],
  ['italic', 'format_italic', 'Cursiva'],
  ['underline', 'format_underlined', 'Subrayado'],
  ['insertUnorderedList', 'format_list_bulleted', 'Lista'],
  ['insertOrderedList', 'format_list_numbered', 'Lista numerada'],
  ['formatBlock:blockquote', 'format_quote', 'Cita'],
  ['formatBlock:pre', 'code', 'Bloque de código'],
  ['removeFormat', 'format_clear', 'Limpiar formato'],
];

const INLINE_IMAGE_TARGET_LENGTH = 36000;

function escapeAttribute(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen seleccionada.'));
    };
    image.src = url;
  });
}

async function optimizeInlineImage(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Selecciona un archivo de imagen válido.');
  const { image, url } = await loadImage(file);
  try {
    let scale = Math.min(1, 1200 / image.naturalWidth, 1200 / image.naturalHeight);
    let quality = 0.84;
    let result = '';

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const width = Math.max(320, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      result = canvas.toDataURL('image/jpeg', quality);
      if (result.length <= INLINE_IMAGE_TARGET_LENGTH) break;
      if (quality > 0.42) quality -= 0.1;
      else scale *= 0.78;
    }

    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function RichTextEditor({ value, onChange, disabled = false }) {
  const editorRef = useRef(null);
  const imageInputRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [imageError, setImageError] = useState('');
  const [processingImage, setProcessingImage] = useState(false);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = value || '';
  }, [value]);

  function emit() {
    onChange(editorRef.current?.innerHTML || '');
  }

  function rememberSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection?.();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection?.();
    if (!editor || !selection) return;
    editor.focus();
    selection.removeAllRanges();
    if (savedRangeRef.current) selection.addRange(savedRangeRef.current);
  }

  function run(tool) {
    if (disabled) return;
    restoreSelection();
    if (tool.startsWith('formatBlock:')) {
      document.execCommand('formatBlock', false, tool.split(':')[1]);
    } else {
      document.execCommand(tool, false);
    }
    emit();
    rememberSelection();
  }

  function setHeading(event) {
    restoreSelection();
    document.execCommand('formatBlock', false, event.target.value || 'p');
    event.target.value = '';
    emit();
    rememberSelection();
  }

  function addLink() {
    if (disabled) return;
    rememberSelection();
    const url = window.prompt('Pega el enlace que deseas insertar:');
    if (!url) return;
    restoreSelection();
    document.execCommand('createLink', false, url);
    emit();
    rememberSelection();
  }

  async function insertImage(file) {
    if (disabled || !file) return;
    setImageError('');
    setProcessingImage(true);
    try {
      const dataUrl = await optimizeInlineImage(file);
      restoreSelection();
      const alt = escapeAttribute(file.name.replace(/\.[^.]+$/, '') || 'Imagen del tutorial');
      document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="${alt}"><p><br></p>`);
      emit();
      rememberSelection();
    } catch (error) {
      setImageError(error.message || 'No se pudo insertar la imagen.');
    } finally {
      setProcessingImage(false);
    }
  }

  function openImagePicker() {
    if (disabled) return;
    rememberSelection();
    imageInputRef.current?.click();
  }

  function handleImageInput(event) {
    const [file] = [...(event.target.files || [])];
    event.target.value = '';
    insertImage(file);
  }

  function handlePaste(event) {
    if (disabled) return;
    const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const file = imageItem?.getAsFile();
    if (!file) return;
    event.preventDefault();
    rememberSelection();
    insertImage(file);
  }

  function handleDrop(event) {
    if (disabled) return;
    const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    rememberSelection();
    insertImage(file);
  }

  return <div className={`knowledge-editor${disabled ? ' is-disabled' : ''}`}>
    <div className="knowledge-editor__toolbar" role="toolbar" aria-label="Formato del documento" onMouseDown={rememberSelection}>
      <select defaultValue="" onChange={setHeading} disabled={disabled} aria-label="Estilo de texto">
        <option value="" disabled>Estilo</option>
        <option value="p">Párrafo</option>
        <option value="h1">Título 1</option>
        <option value="h2">Título 2</option>
        <option value="h3">Título 3</option>
      </select>
      {TOOLS.map(([command, icon, label]) => <button key={command} type="button" title={label} aria-label={label} onClick={() => run(command)} disabled={disabled}><Icon name={icon} /></button>)}
      <button type="button" title="Insertar enlace" aria-label="Insertar enlace" onClick={addLink} disabled={disabled}><Icon name="link" /></button>
      <button type="button" title="Insertar imagen" aria-label="Insertar imagen" onClick={openImagePicker} disabled={disabled || processingImage}><Icon name={processingImage ? 'progress_activity' : 'image'} /></button>
      <input ref={imageInputRef} className="knowledge-editor__image-input" type="file" accept="image/*" onChange={handleImageInput} tabIndex="-1" aria-hidden="true" />
    </div>
    {imageError && <div className="knowledge-editor__image-error"><Icon name="error" /><span>{imageError}</span></div>}
    <div
      ref={editorRef}
      className="knowledge-editor__document"
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder="Escribe el procedimiento paso a paso. Puedes usar títulos, listas, enlaces, citas, código e imágenes."
      onInput={() => { emit(); rememberSelection(); }}
      onBlur={() => { emit(); rememberSelection(); }}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
    />
  </div>;
}
