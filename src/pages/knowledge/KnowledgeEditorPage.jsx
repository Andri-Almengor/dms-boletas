import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import KnowledgeCategoryMultiSelect from '../../components/knowledge/KnowledgeCategoryMultiSelect';
import RichTextEditor from '../../components/knowledge/RichTextEditor';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { fileToDataUrl, getAttachmentId, getAttachmentName, normalizeKnowledge, stripHtml } from '../../utils/knowledge';

const EMPTY_FORM = {
  title: '',
  categoryIds: [],
  problem: '',
  content: '<h2>Objetivo</h2><p></p><h2>Procedimiento paso a paso</h2><ol><li></li></ol><h2>Validación final</h2><p></p>',
  status: 'BORRADOR',
  videos: [''],
};
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const KNOWLEDGE_AI_ROUTES = ['ai.knowledgeRewrite', 'gemini.knowledgeRewrite', 'knowledge.ai.rewrite', 'baseConocimientos.ai.rewrite'];
const SAFE_AI_TAGS = new Set(['H1', 'H2', 'H3', 'P', 'OL', 'UL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'BR', 'SPAN', 'DIV']);

function canCreateTutorial(hasPermission) {
  return hasPermission('CONOCIMIENTO_CREAR') || hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('BOLETAS_CREAR') || hasPermission('USUARIOS_GESTIONAR');
}

function normalizeDraftForm(value = {}) {
  const legacyId = String(value.categoryId || '').trim();
  const categoryIds = Array.isArray(value.categoryIds)
    ? value.categoryIds.map(String).filter(Boolean)
    : legacyId ? [legacyId] : [];
  return { ...EMPTY_FORM, ...value, categoryIds };
}

function prepareHtmlForGemini(html = '') {
  const images = [];
  const contentHtml = String(html).replace(/<img\b[^>]*>/gi, (tag) => {
    const token = `[[IMAGEN_${images.length + 1}]]`;
    images.push({ token, tag });
    return `<p>${token}</p>`;
  });
  return { contentHtml, images };
}

function sanitizeGeminiHtml(html = '') {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(`<div id="dms-ai-root">${String(html)}</div>`, 'text/html');
  const root = documentNode.getElementById('dms-ai-root');
  if (!root) return '';

  root.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,meta,link').forEach((node) => node.remove());
  [...root.querySelectorAll('*')].forEach((node) => {
    if (!SAFE_AI_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'id') node.removeAttribute(attribute.name);
      if (node.tagName !== 'A' && name !== 'data-knowledge-size') node.removeAttribute(attribute.name);
    });
    if (node.tagName === 'A') {
      const href = String(node.getAttribute('href') || '').trim();
      if (!/^(https?:\/\/|mailto:|#)/i.test(href)) node.removeAttribute('href');
      else {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
  return root.innerHTML;
}

function restoreInlineImages(html, images = []) {
  let restored = String(html || '');
  images.forEach(({ token, tag }) => {
    if (restored.includes(token)) restored = restored.replace(token, tag);
    else restored += `<p>${tag}</p>`;
    restored = restored.split(token).join('');
  });
  return restored;
}

export default function KnowledgeEditorPage({ mode }) {
  const { tutorialId } = useParams();
  const navigate = useNavigate();
  const { sessionToken, user, hasPermission } = useAuth();
  const canCreate = canCreateTutorial(hasPermission);
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(EMPTY_FORM);
  const [categories, setCategories] = useState([]);
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [savedLocally, setSavedLocally] = useState(false);
  const [aiBusy, setAiBusy] = useState('');
  const [aiNotice, setAiNotice] = useState('');
  const [aiSnapshot, setAiSnapshot] = useState(null);
  const userId = String(pick(user, ['UsuarioID', 'id'], ''));
  const draftKey = `dms_knowledge_draft_${tutorialId || 'new'}_${userId || 'user'}`;

  useEffect(() => {
    requestAvailable(MODULE_ROUTES.knowledgeCategories.list, { page: 1, pageSize: 300, activo: true, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken)
      .then((data) => setCategories(normalizeItems(data)))
      .catch((err) => setError(err.message));
  }, [sessionToken]);

  useEffect(() => {
    setLoadError('');
    if (!isEdit) {
      try {
        const local = JSON.parse(localStorage.getItem(draftKey) || 'null');
        if (local?.form) setForm(normalizeDraftForm(local.form));
      } catch { /* Ignorar borradores dañados o almacenamiento no disponible. */ }
      return;
    }
    setLoading(true);
    requestAvailable(MODULE_ROUTES.knowledge.get, { tutorialId, TutorialID: tutorialId }, sessionToken)
      .then((data) => {
        const item = normalizeKnowledge(data?.item || data?.data || data);
        const canManage = hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
        if (!canManage && item.authorId && item.authorId !== userId) throw new Error('Solo puedes editar tus propios tutoriales.');
        setForm({
          title: item.title,
          categoryIds: item.categoryIds,
          problem: item.problem,
          content: item.content,
          status: item.status,
          videos: item.videos.length ? item.videos.map((video) => typeof video === 'string' ? video : pick(video, ['URL', 'url'])) : [''],
        });
        setExistingAttachments(item.attachments);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [isEdit, tutorialId, sessionToken, userId, hasPermission]);

  useEffect(() => {
    if (loading || loadError) return undefined;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ form, savedAt: new Date().toISOString() }));
        setSavedLocally(true);
        window.setTimeout(() => setSavedLocally(false), 1600);
      } catch {
        setSavedLocally(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [form, loading, loadError, draftKey]);

  const categoryOptions = useMemo(() => categories.map((category) => ({
    value: String(pick(category, ['CategoriaConocimientoID', 'CategoriaID', 'id'])),
    label: pick(category, ['Nombre', 'name']),
  })).filter((item) => item.value && item.label), [categories]);

  function setField(name, value) { setForm((current) => ({ ...current, [name]: value })); }
  function updateVideo(index, value) { setForm((current) => ({ ...current, videos: current.videos.map((item, itemIndex) => itemIndex === index ? value : item) })); }
  function addVideo() { setForm((current) => ({ ...current, videos: [...current.videos, ''] })); }
  function removeVideo(index) {
    setForm((current) => {
      const next = current.videos.filter((_, itemIndex) => itemIndex !== index);
      return { ...current, videos: next.length ? next : [''] };
    });
  }

  function selectFiles(event) {
    const files = [...event.target.files];
    const tooLarge = files.find((file) => file.size > MAX_FILE_SIZE);
    if (tooLarge) {
      setError(`${tooLarge.name} supera 20 MB. Para videos grandes utiliza un enlace de YouTube, Vimeo o Drive.`);
      event.target.value = '';
      return;
    }
    setError('');
    setNewFiles((current) => [...current, ...files]);
    event.target.value = '';
  }

  async function deleteExistingAttachment(attachment) {
    if (!window.confirm(`¿Eliminar ${getAttachmentName(attachment)}?`)) return;
    try {
      await requestAvailable(MODULE_ROUTES.knowledge.attachmentDelete, { tutorialId, adjuntoId: getAttachmentId(attachment) }, sessionToken);
      setExistingAttachments((current) => current.filter((item) => getAttachmentId(item) !== getAttachmentId(attachment)));
    } catch (err) { setError(err.message); }
  }

  async function improveWithGemini(requestedMode) {
    const visibleText = stripHtml(form.content).trim();
    if (!visibleText) {
      setError('Escriba el documento paso a paso antes de usar Gemini.');
      return;
    }

    const snapshot = { title: form.title, problem: form.problem, content: form.content };
    const prepared = prepareHtmlForGemini(form.content);
    const selectedCategories = categoryOptions
      .filter((option) => form.categoryIds.includes(option.value))
      .map((option) => option.label);

    setAiBusy(requestedMode);
    setError('');
    setAiNotice('');
    try {
      const response = await requestAvailable(KNOWLEDGE_AI_ROUTES, {
        mode: requestedMode,
        titulo: form.title,
        problema: form.problem,
        categorias: selectedCategories,
        contenidoHtml: prepared.contentHtml,
      }, sessionToken);
      const improvedTitle = String(pick(response, ['titulo', 'title'], form.title)).trim();
      const improvedProblem = String(pick(response, ['problema', 'problemaResuelto', 'problem'], form.problem)).trim();
      let improvedContent = form.content;
      if (requestedMode === 'FULL') {
        const receivedHtml = pick(response, ['contenidoHtml', 'contentHtml', 'content'], prepared.contentHtml);
        improvedContent = restoreInlineImages(sanitizeGeminiHtml(receivedHtml), prepared.images);
      }
      setAiSnapshot(snapshot);
      setForm((current) => ({
        ...current,
        title: requestedMode === 'PROBLEM_ONLY' ? current.title : (improvedTitle || current.title),
        problem: requestedMode === 'TITLE_ONLY' ? current.problem : (improvedProblem || current.problem),
        content: requestedMode === 'FULL' ? improvedContent : current.content,
      }));

      if (requestedMode === 'FULL') {
        setAiNotice('Gemini mejoró el documento y generó el título y la descripción del problema. Revise el resultado antes de publicar.');
      } else if (requestedMode === 'PROBLEM_ONLY') {
        setAiNotice('Gemini generó la descripción del problema a partir del documento paso a paso.');
      } else {
        setAiNotice('Gemini generó un título basado en el contenido del procedimiento.');
      }
    } catch (err) {
      setError(err.message || 'No se pudo procesar el tutorial con Gemini.');
    } finally {
      setAiBusy('');
    }
  }

  function undoGemini() {
    if (!aiSnapshot) return;
    setForm((current) => ({
      ...current,
      title: aiSnapshot.title,
      problem: aiSnapshot.problem,
      content: aiSnapshot.content,
    }));
    setAiSnapshot(null);
    setAiNotice('Se restauró la versión anterior del título, la descripción y el documento.');
  }

  async function save(event, forcedStatus = form.status) {
    event?.preventDefault();
    setError('');
    if (!form.title.trim() || !form.categoryIds.length || !form.problem.trim() || !stripHtml(form.content)) {
      setError('Completa el título, selecciona al menos una categoría, describe el problema y agrega el contenido del tutorial.');
      return;
    }
    setSaving(true);
    try {
      const primaryCategoryId = form.categoryIds[0];
      const payload = {
        tutorialId,
        TutorialID: tutorialId,
        titulo: form.title.trim(),
        Titulo: form.title.trim(),
        categoriaIds: form.categoryIds,
        CategoriaConocimientoIDs: form.categoryIds,
        categoriaId: primaryCategoryId,
        CategoriaConocimientoID: primaryCategoryId,
        problemaResuelto: form.problem.trim(),
        ProblemaResuelto: form.problem.trim(),
        contenidoHtml: form.content,
        ContenidoHTML: form.content,
        videos: form.videos.map((item) => item.trim()).filter(Boolean),
        estado: forcedStatus,
        Estado: forcedStatus,
      };
      const response = await requestAvailable(isEdit ? MODULE_ROUTES.knowledge.update : MODULE_ROUTES.knowledge.create, payload, sessionToken);
      const savedId = String(pick(response, ['TutorialID', 'tutorialId', 'id'], tutorialId));
      if (!savedId) throw new Error('El backend guardó el tutorial pero no devolvió su identificador.');
      for (const file of [...newFiles]) {
        const dataUrl = await fileToDataUrl(file);
        await requestAvailable(MODULE_ROUTES.knowledge.attachmentUpload, { tutorialId: savedId, nombre: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, dataUrl }, sessionToken);
        setNewFiles((current) => current.filter((item) => item !== file));
      }
      try { localStorage.removeItem(draftKey); } catch { /* El guardado del servidor ya terminó. */ }
      navigate(`/conocimiento/${encodeURIComponent(savedId)}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!isEdit && !canCreate) return <Navigate to="/conocimiento" replace />;
  if (loading) return <div className="page page--narrow"><div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando documento...</div></div>;
  if (loadError) return <div className="page page--narrow"><div className="alert alert--error"><Icon name="error" /><span>{loadError}</span></div><button className="button button--secondary" type="button" onClick={() => navigate('/conocimiento')}><Icon name="arrow_back" /> Volver</button></div>;

  const aiDisabled = saving || Boolean(aiBusy);

  return <div className="page knowledge-editor-page">
    <div className="page-header knowledge-editor-header">
      <button className="icon-button" type="button" onClick={() => navigate(isEdit ? `/conocimiento/${tutorialId}` : '/conocimiento')} aria-label="Volver"><Icon name="arrow_back" /></button>
      <div><span className="eyebrow">Base de conocimientos</span><h1>{isEdit ? 'Editar tutorial' : 'Nuevo tutorial'}</h1></div>
      <span className={`autosave-indicator${savedLocally ? ' autosave-indicator--local' : ''}`}><Icon name={savedLocally ? 'cloud_done' : 'cloud'} /> {savedLocally ? 'Borrador guardado' : 'Autoguardado local'}</span>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {aiNotice && <div className="alert alert--success"><Icon name="auto_awesome" /><span>{aiNotice}</span></div>}

    <form onSubmit={(event) => save(event, form.status)}>
      <section className="form-card knowledge-basics-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Información del tutorial</h2><p>Relaciona el procedimiento con todas las plataformas, marcas o sistemas involucrados.</p></div></div>
        <div className="knowledge-basics-grid">
          <div className="field-group is-wide">
            <div className="field-label-row knowledge-ai-field-label"><label className="field-label" htmlFor="knowledge-title">Título del tutorial *</label><button className="knowledge-ai-inline-button" type="button" onClick={() => improveWithGemini('TITLE_ONLY')} disabled={aiDisabled}><Icon name={aiBusy === 'TITLE_ONLY' ? 'progress_activity' : 'auto_awesome'} /> {aiBusy === 'TITLE_ONLY' ? 'Generando...' : 'Generar título con Gemini'}</button></div>
            <input id="knowledge-title" className="form-control" value={form.title} onChange={(event) => setField('title', event.target.value)} placeholder="Ej. Configurar una IP estática en Windows 11" required disabled={aiDisabled} />
            <small className="field-hint">Gemini usa el documento para incluir palabras comunes y técnicas que faciliten encontrar el tutorial.</small>
          </div>
          <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.status} onChange={(event) => setField('status', event.target.value)} disabled={saving}><option value="BORRADOR">Borrador</option><option value="PUBLICADO">Publicado</option></select></label>
          <div className="field-group is-wide">
            <KnowledgeCategoryMultiSelect options={categoryOptions} selectedIds={form.categoryIds} onChange={(value) => setField('categoryIds', value)} disabled={aiDisabled} />
          </div>
          <div className="field-group is-wide">
            <div className="field-label-row knowledge-ai-field-label"><label className="field-label" htmlFor="knowledge-problem">Descripción del problema que resuelve *</label><button className="knowledge-ai-inline-button" type="button" onClick={() => improveWithGemini('PROBLEM_ONLY')} disabled={aiDisabled}><Icon name={aiBusy === 'PROBLEM_ONLY' ? 'progress_activity' : 'auto_awesome'} /> {aiBusy === 'PROBLEM_ONLY' ? 'Generando...' : 'Generar descripción con Gemini'}</button></div>
            <textarea id="knowledge-problem" className="form-control ticket-textarea" rows="4" value={form.problem} onChange={(event) => setField('problem', event.target.value)} placeholder="Gemini puede generar esta descripción a partir del documento paso a paso." required disabled={aiDisabled} />
            <small className="field-hint">Describe qué necesidad, error o situación resuelve el procedimiento y cuándo debe utilizarse.</small>
          </div>
        </div>
      </section>

      <section className="form-card knowledge-document-card">
        <div className="form-card__heading knowledge-ai-document-heading"><span className="section-marker" /><div><h2>Documento paso a paso</h2><p>Gemini puede ordenar los pasos y generar automáticamente el título y la descripción del problema sin inventar información.</p></div><div className="knowledge-ai-actions"><button className="button button--secondary button--compact" type="button" onClick={() => improveWithGemini('FULL')} disabled={aiDisabled}><Icon name={aiBusy === 'FULL' ? 'progress_activity' : 'auto_awesome'} /> {aiBusy === 'FULL' ? 'Mejorando...' : 'Mejorar documento, título y descripción'}</button>{aiSnapshot && <button className="button button--ghost button--compact" type="button" onClick={undoGemini} disabled={aiDisabled}><Icon name="undo" /> Deshacer mejora</button>}</div></div>
        <RichTextEditor value={form.content} onChange={(value) => setField('content', value)} disabled={aiDisabled} />
        <div className="knowledge-ai-help"><Icon name="verified_user" /><p>Gemini conserva las imágenes, enlaces, direcciones IP, comandos, marcas, modelos y valores técnicos escritos. También usa el contexto del procedimiento para completar la descripción del problema. Revise siempre el resultado antes de publicarlo.</p></div>
      </section>

      <section className="form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Videos</h2><p>Agrega enlaces de YouTube, Vimeo, Drive u otra plataforma.</p></div></div>
        <div className="knowledge-video-fields">{form.videos.map((video, index) => <div key={index}><label className="field-group"><span className="field-label">Video {index + 1}</span><input className="form-control" type="url" value={video} onChange={(event) => updateVideo(index, event.target.value)} placeholder="https://..." disabled={saving} /></label><button type="button" className="icon-button icon-button--outlined" onClick={() => removeVideo(index)} aria-label="Quitar video" disabled={saving}><Icon name="delete" /></button></div>)}</div>
        <button type="button" className="button button--secondary button--compact" onClick={addVideo} disabled={saving}><Icon name="add" /> Agregar otro video</button>
      </section>

      <section className="form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Documentos y archivos</h2><p>Adjunta PDF, Word, Excel, imágenes o videos de hasta 20 MB por archivo.</p></div></div>
        <label className="knowledge-file-drop"><input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*,video/*" onChange={selectFiles} disabled={saving} /><Icon name="upload_file" /><strong>Seleccionar documentos o videos</strong><span>Puede seleccionar varios archivos desde el explorador.</span></label>
        {(existingAttachments.length > 0 || newFiles.length > 0) && <div className="knowledge-file-list">
          {existingAttachments.map((attachment, index) => <article key={getAttachmentId(attachment) || index}><Icon name="description" /><div><strong>{getAttachmentName(attachment)}</strong><small>Archivo guardado</small></div><button type="button" className="icon-button" onClick={() => deleteExistingAttachment(attachment)} aria-label={`Eliminar ${getAttachmentName(attachment)}`} disabled={saving}><Icon name="delete" /></button></article>)}
          {newFiles.map((file, index) => <article key={`${file.name}-${file.lastModified}-${index}`}><Icon name={file.type.startsWith('video/') ? 'movie' : 'draft'} /><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · Pendiente de subir</small></div><button type="button" className="icon-button" onClick={() => setNewFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Quitar ${file.name}`} disabled={saving}><Icon name="close" /></button></article>)}
        </div>}
      </section>

      <div className="knowledge-editor-actions">
        <button type="button" className="button button--secondary" disabled={saving || Boolean(aiBusy)} onClick={(event) => save(event, 'BORRADOR')}><Icon name="save" /> Guardar borrador</button>
        <button type="button" className="button button--primary" disabled={saving || Boolean(aiBusy)} onClick={(event) => save(event, 'PUBLICADO')}><Icon name="publish" /> {saving ? 'Guardando...' : 'Publicar tutorial'}</button>
      </div>
    </form>
  </div>;
}
