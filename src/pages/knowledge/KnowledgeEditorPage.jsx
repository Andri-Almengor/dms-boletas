import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import RichTextEditor from '../../components/knowledge/RichTextEditor';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { fileToDataUrl, getAttachmentId, getAttachmentName, normalizeKnowledge, stripHtml } from '../../utils/knowledge';

const EMPTY_FORM = { title: '', categoryId: '', problem: '', content: '<h2>Objetivo</h2><p></p><h2>Procedimiento paso a paso</h2><ol><li></li></ol><h2>Validación final</h2><p></p>', status: 'BORRADOR', videos: [''] };
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function canCreateTutorial(hasPermission) {
  return hasPermission('CONOCIMIENTO_CREAR') || hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('BOLETAS_CREAR') || hasPermission('USUARIOS_GESTIONAR');
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
        if (local?.form) setForm({ ...EMPTY_FORM, ...local.form });
      } catch { /* Ignorar borradores dañados o almacenamiento no disponible. */ }
      return;
    }
    setLoading(true);
    requestAvailable(MODULE_ROUTES.knowledge.get, { tutorialId, TutorialID: tutorialId }, sessionToken)
      .then((data) => {
        const item = normalizeKnowledge(data?.item || data?.data || data);
        const canManage = hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
        if (!canManage && item.authorId && item.authorId !== userId) throw new Error('Solo puedes editar tus propios tutoriales.');
        setForm({ title: item.title, categoryId: item.categoryId, problem: item.problem, content: item.content, status: item.status, videos: item.videos.length ? item.videos.map((video) => typeof video === 'string' ? video : pick(video, ['URL', 'url'])) : [''] });
        setExistingAttachments(item.attachments);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [isEdit, tutorialId, sessionToken, userId]);

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

  const categoryOptions = useMemo(() => categories.map((category) => ({ value: String(pick(category, ['CategoriaConocimientoID', 'CategoriaID', 'id'])), label: pick(category, ['Nombre', 'name']) })).filter((item) => item.value && item.label), [categories]);

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

  async function save(event, forcedStatus = form.status) {
    event?.preventDefault();
    setError('');
    if (!form.title.trim() || !form.categoryId || !form.problem.trim() || !stripHtml(form.content)) {
      setError('Completa el título, la categoría, el problema que resuelve y el contenido del tutorial.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tutorialId,
        TutorialID: tutorialId,
        titulo: form.title.trim(),
        Titulo: form.title.trim(),
        categoriaId: form.categoryId,
        CategoriaConocimientoID: form.categoryId,
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

  return <div className="page knowledge-editor-page">
    <div className="page-header knowledge-editor-header">
      <button className="icon-button" type="button" onClick={() => navigate(isEdit ? `/conocimiento/${tutorialId}` : '/conocimiento')} aria-label="Volver"><Icon name="arrow_back" /></button>
      <div><span className="eyebrow">Base de conocimientos</span><h1>{isEdit ? 'Editar tutorial' : 'Nuevo tutorial'}</h1></div>
      <span className={`autosave-indicator${savedLocally ? ' autosave-indicator--local' : ''}`}><Icon name={savedLocally ? 'cloud_done' : 'cloud'} /> {savedLocally ? 'Borrador guardado' : 'Autoguardado local'}</span>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    <form onSubmit={(event) => save(event, form.status)}>
      <section className="form-card knowledge-basics-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Información del tutorial</h2><p>Describe claramente qué problema resuelve y a qué tecnología pertenece.</p></div></div>
        <div className="knowledge-basics-grid">
          <label className="field-group is-wide"><span className="field-label">Título del tutorial *</span><input className="form-control" value={form.title} onChange={(event) => setField('title', event.target.value)} placeholder="Ej. Cómo restablecer la comunicación de un panel Lenel" required /></label>
          <label className="field-group"><span className="field-label">Categoría *</span><select className="form-control" value={form.categoryId} onChange={(event) => setField('categoryId', event.target.value)} required><option value="">Seleccione una categoría</option>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.status} onChange={(event) => setField('status', event.target.value)}><option value="BORRADOR">Borrador</option><option value="PUBLICADO">Publicado</option></select></label>
          <label className="field-group is-wide"><span className="field-label">Descripción del problema que resuelve *</span><textarea className="form-control ticket-textarea" rows="4" value={form.problem} onChange={(event) => setField('problem', event.target.value)} placeholder="Explica el síntoma, error o necesidad que llevó a crear este procedimiento." required /></label>
        </div>
      </section>

      <section className="form-card knowledge-document-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Documento paso a paso</h2><p>Redacta el tutorial dentro de la aplicación con formato similar a un documento.</p></div></div>
        <RichTextEditor value={form.content} onChange={(value) => setField('content', value)} />
      </section>

      <section className="form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Videos</h2><p>Agrega enlaces de YouTube, Vimeo, Drive u otra plataforma.</p></div></div>
        <div className="knowledge-video-fields">{form.videos.map((video, index) => <div key={index}><label className="field-group"><span className="field-label">Video {index + 1}</span><input className="form-control" type="url" value={video} onChange={(event) => updateVideo(index, event.target.value)} placeholder="https://..." /></label><button type="button" className="icon-button icon-button--outlined" onClick={() => removeVideo(index)} aria-label="Quitar video"><Icon name="delete" /></button></div>)}</div>
        <button type="button" className="button button--secondary button--compact" onClick={addVideo}><Icon name="add" /> Agregar otro video</button>
      </section>

      <section className="form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Documentos y archivos</h2><p>Adjunta PDF, Word, Excel, imágenes o videos de hasta 20 MB por archivo.</p></div></div>
        <label className="knowledge-file-drop"><input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*,video/*" onChange={selectFiles} /><Icon name="upload_file" /><strong>Seleccionar documentos o videos</strong><span>Puede seleccionar varios archivos desde el explorador.</span></label>
        {(existingAttachments.length > 0 || newFiles.length > 0) && <div className="knowledge-file-list">
          {existingAttachments.map((attachment, index) => <article key={getAttachmentId(attachment) || index}><Icon name="description" /><div><strong>{getAttachmentName(attachment)}</strong><small>Archivo guardado</small></div><button type="button" className="icon-button" onClick={() => deleteExistingAttachment(attachment)} aria-label={`Eliminar ${getAttachmentName(attachment)}`}><Icon name="delete" /></button></article>)}
          {newFiles.map((file, index) => <article key={`${file.name}-${file.lastModified}-${index}`}><Icon name={file.type.startsWith('video/') ? 'movie' : 'draft'} /><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · Pendiente de subir</small></div><button type="button" className="icon-button" onClick={() => setNewFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Quitar ${file.name}`}><Icon name="close" /></button></article>)}
        </div>}
      </section>

      <div className="knowledge-editor-actions">
        <button type="button" className="button button--secondary" disabled={saving} onClick={(event) => save(event, 'BORRADOR')}><Icon name="save" /> Guardar borrador</button>
        <button type="button" className="button button--primary" disabled={saving} onClick={(event) => save(event, 'PUBLICADO')}><Icon name="publish" /> {saving ? 'Guardando...' : 'Publicar tutorial'}</button>
      </div>
    </form>
  </div>;
}
