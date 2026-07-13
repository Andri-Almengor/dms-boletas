import React, { useEffect, useRef } from 'react';
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

export default function RichTextEditor({ value, onChange, disabled = false }) {
  const editorRef = useRef(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = value || '';
  }, [value]);

  function emit() {
    onChange(editorRef.current?.innerHTML || '');
  }

  function run(tool) {
    if (disabled) return;
    editorRef.current?.focus();
    if (tool.startsWith('formatBlock:')) {
      document.execCommand('formatBlock', false, tool.split(':')[1]);
    } else {
      document.execCommand(tool, false);
    }
    emit();
  }

  function setHeading(event) {
    editorRef.current?.focus();
    document.execCommand('formatBlock', false, event.target.value || 'p');
    event.target.value = '';
    emit();
  }

  function addLink() {
    if (disabled) return;
    const url = window.prompt('Pega el enlace que deseas insertar:');
    if (!url) return;
    editorRef.current?.focus();
    document.execCommand('createLink', false, url);
    emit();
  }

  return <div className={`knowledge-editor${disabled ? ' is-disabled' : ''}`}>
    <div className="knowledge-editor__toolbar" role="toolbar" aria-label="Formato del documento">
      <select defaultValue="" onChange={setHeading} disabled={disabled} aria-label="Estilo de texto">
        <option value="" disabled>Estilo</option>
        <option value="p">Párrafo</option>
        <option value="h1">Título 1</option>
        <option value="h2">Título 2</option>
        <option value="h3">Título 3</option>
      </select>
      {TOOLS.map(([command, icon, label]) => <button key={command} type="button" title={label} aria-label={label} onClick={() => run(command)} disabled={disabled}><Icon name={icon} /></button>)}
      <button type="button" title="Insertar enlace" aria-label="Insertar enlace" onClick={addLink} disabled={disabled}><Icon name="link" /></button>
    </div>
    <div
      ref={editorRef}
      className="knowledge-editor__document"
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder="Escribe el procedimiento paso a paso. Puedes usar títulos, listas, enlaces, citas y bloques de código."
      onInput={emit}
      onBlur={emit}
    />
  </div>;
}
