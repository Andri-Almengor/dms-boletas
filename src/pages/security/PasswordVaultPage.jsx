import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import {
  createPasswordVaultCategory,
  createPasswordVaultCredential,
  deletePasswordVaultCategory,
  deletePasswordVaultCredential,
  getPasswordVaultDashboard,
  revealPasswordVaultCredential,
  updatePasswordVaultCategory,
  updatePasswordVaultCredential,
} from '../../services/passwordVault';
import '../../styles/password-vault.css';

const EMPTY_CATEGORY = Object.freeze({ id: '', name: '', description: '' });
const EMPTY_CREDENTIAL = Object.freeze({
  id: '',
  clientId: '',
  categoryId: '',
  name: '',
  username: '',
  password: '',
  url: '',
  notes: '',
});

function normalized(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function PasswordVaultModal({ open, title, subtitle, icon, busy, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.();
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
    };
  }, [open, busy, onClose]);

  if (!open) return null;
  return <div className="password-vault-modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose?.();
  }}>
    <section className="password-vault-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header>
        <span><Icon name={icon} /></span>
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
      </header>
      <div className="password-vault-modal__body">{children}</div>
    </section>
  </div>;
}

function CategoryForm({ form, setForm, busy, error, onSubmit, onCancel }) {
  return <form className="password-vault-form" onSubmit={onSubmit}>
    <label><span>Nombre de la categoría *</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength="180" autoFocus required placeholder="Ej. Sistemas, Cámaras, Control de acceso" /></label>
    <label><span>Descripción</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows="4" maxLength="1200" placeholder="Explique qué tipo de accesos se guardan en esta categoría." /></label>
    {error && <div className="password-vault-alert is-error"><Icon name="error" /><span>{error}</span></div>}
    <div className="password-vault-form__actions"><button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>Cancelar</button><button className="button button--primary" disabled={busy}><Icon name={busy ? 'progress_activity' : 'save'} />{busy ? 'Guardando...' : 'Guardar categoría'}</button></div>
  </form>;
}

function CredentialForm({ form, setForm, clients, categories, busy, error, editing, onSubmit, onCancel }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <form className="password-vault-form password-vault-form--credential" onSubmit={onSubmit} autoComplete="off">
    <label><span>Cliente *</span><select value={form.clientId} onChange={change('clientId')} required><option value="">Seleccione un cliente</option>{clients.filter((item) => item.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
    <label><span>Categoría *</span><select value={form.categoryId} onChange={change('categoryId')} required><option value="">Seleccione una categoría</option>{categories.filter((item) => item.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label className="is-wide"><span>Nombre del sistema o servicio *</span><input value={form.name} onChange={change('name')} maxLength="250" required placeholder="Ej. Milestone XProtect, NVR Recepción, Lenel OnGuard" /></label>
    <label><span>Usuario *</span><input value={form.username} onChange={change('username')} maxLength="500" required autoComplete="off" placeholder="Ej. Admin" /></label>
    <label><span>Contraseña {editing ? '' : '*'}</span><input value={form.password} onChange={change('password')} type="password" maxLength="4096" required={!editing} autoComplete="new-password" placeholder={editing ? 'Déjela vacía para conservar la actual' : 'Escriba la contraseña'} /></label>
    <label className="is-wide"><span>URL o dirección de acceso</span><input value={form.url} onChange={change('url')} maxLength="2000" type="text" placeholder="https://..., 192.168.1.10 o nombre del servidor" /></label>
    <label className="is-wide"><span>Notas</span><textarea value={form.notes} onChange={change('notes')} rows="4" maxLength="4000" placeholder="Ubicación, alcance, observaciones o instrucciones breves." /></label>
    {error && <div className="password-vault-alert is-error"><Icon name="error" /><span>{error}</span></div>}
    <div className="password-vault-form__actions"><button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>Cancelar</button><button className="button button--primary" disabled={busy}><Icon name={busy ? 'progress_activity' : 'save'} />{busy ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar credencial'}</button></div>
  </form>;
}

function CredentialCard({ item, canManage, revealed, onReveal, onCopy, onEdit, onDelete }) {
  const visible = Boolean(revealed?.password);
  return <article className="password-vault-credential-card">
    <header>
      <span className="password-vault-credential-card__icon"><Icon name="key" /></span>
      <div><strong>{item.name}</strong><small>{item.categoryName}</small></div>
      {canManage && <div className="password-vault-credential-card__admin"><button type="button" onClick={() => onEdit(item)} title="Editar"><Icon name="edit" /></button><button type="button" onClick={() => onDelete(item)} title="Eliminar"><Icon name="delete" /></button></div>}
    </header>
    <div className="password-vault-credential-card__fields">
      <div><span>Usuario</span><strong>{item.username}</strong><button type="button" onClick={() => navigator.clipboard.writeText(item.username)} title="Copiar usuario"><Icon name="content_copy" /></button></div>
      <div className="is-secret"><span>Contraseña</span><code>{visible ? revealed.password : item.passwordMasked}</code><button type="button" onClick={() => onReveal(item)} title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}><Icon name={visible ? 'visibility_off' : 'visibility'} /></button><button type="button" onClick={() => onCopy(item)} title="Copiar contraseña"><Icon name="content_copy" /></button></div>
    </div>
    {(item.url || item.notes) && <div className="password-vault-credential-card__details">{item.url && <a href={/^https?:\/\//i.test(item.url) ? item.url : undefined} target="_blank" rel="noreferrer"><Icon name="link" /><span>{item.url}</span></a>}{item.notes && <p>{item.notes}</p>}</div>}
    {visible && <small className="password-vault-secret-expiry"><Icon name="timer" />Se ocultará automáticamente en 30 segundos.</small>}
  </article>;
}

export default function PasswordVaultPage() {
  const { sessionToken, hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ clients: [], categories: [], credentials: [], canManage: false, encryptionConfigured: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState(searchParams.get('cliente') || '');
  const [openClients, setOpenClients] = useState(() => new Set());
  const [openCategories, setOpenCategories] = useState(() => new Set());
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY);
  const [credentialModal, setCredentialModal] = useState(false);
  const [credentialForm, setCredentialForm] = useState(EMPTY_CREDENTIAL);
  const [modalError, setModalError] = useState('');
  const [revealed, setRevealed] = useState({});
  const canManage = data.canManage || hasPermission('USUARIOS_GESTIONAR');

  async function load({ preserveMessage = false } = {}) {
    setLoading(true);
    setError('');
    if (!preserveMessage) setMessage('');
    try {
      const result = await getPasswordVaultDashboard({}, sessionToken);
      setData(result);
      const preferred = clientFilter || result.clients.find((item) => item.credentialCount > 0)?.id || result.clients[0]?.id;
      if (preferred) setOpenClients((current) => current.size ? current : new Set([preferred]));
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el gestor de contraseñas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sessionToken]);

  useEffect(() => {
    const hideSecrets = () => {
      if (document.visibilityState === 'hidden') setRevealed({});
    };
    document.addEventListener('visibilitychange', hideSecrets);
    return () => document.removeEventListener('visibilitychange', hideSecrets);
  }, []);

  const filteredCredentials = useMemo(() => {
    const query = normalized(search);
    return data.credentials.filter((item) => {
      if (clientFilter && item.clientId !== clientFilter) return false;
      if (!query) return true;
      return normalized([item.clientName, item.categoryName, item.name, item.username, item.url, item.notes].join(' ')).includes(query);
    });
  }, [data.credentials, clientFilter, search]);

  const grouped = useMemo(() => {
    const byClient = new Map();
    for (const item of filteredCredentials) {
      if (!byClient.has(item.clientId)) byClient.set(item.clientId, new Map());
      const byCategory = byClient.get(item.clientId);
      if (!byCategory.has(item.categoryId)) byCategory.set(item.categoryId, []);
      byCategory.get(item.categoryId).push(item);
    }
    return byClient;
  }, [filteredCredentials]);

  function changeClientFilter(value) {
    setClientFilter(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('cliente', value);
    else next.delete('cliente');
    setSearchParams(next, { replace: true });
    if (value) setOpenClients((current) => new Set([...current, value]));
  }

  function toggleSet(setter, value) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function openNewCategory() {
    setCategoryForm({ ...EMPTY_CATEGORY });
    setModalError('');
    setCategoryModal(true);
  }

  function openEditCategory(category) {
    setCategoryForm({ id: category.id, name: category.name, description: category.description || '' });
    setModalError('');
    setCategoryModal(true);
  }

  function openNewCredential(clientId = '') {
    setCredentialForm({ ...EMPTY_CREDENTIAL, clientId: clientId || clientFilter || '', categoryId: data.categories.find((item) => item.active)?.id || '' });
    setModalError('');
    setCredentialModal(true);
  }

  function openEditCredential(item) {
    setCredentialForm({
      id: item.id,
      clientId: item.clientId,
      categoryId: item.categoryId,
      name: item.name,
      username: item.username,
      password: '',
      url: item.url || '',
      notes: item.notes || '',
    });
    setModalError('');
    setCredentialModal(true);
  }

  async function saveCategory(event) {
    event.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      const payload = { categoryId: categoryForm.id, name: categoryForm.name.trim(), description: categoryForm.description.trim() };
      if (categoryForm.id) await updatePasswordVaultCategory(payload, sessionToken);
      else await createPasswordVaultCategory(payload, sessionToken);
      setCategoryModal(false);
      setMessage(categoryForm.id ? 'La categoría se actualizó correctamente.' : 'La categoría se creó correctamente.');
      await load({ preserveMessage: true });
    } catch (saveError) {
      setModalError(saveError.message || 'No se pudo guardar la categoría.');
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential(event) {
    event.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      const payload = {
        credentialId: credentialForm.id,
        clientId: credentialForm.clientId,
        categoryId: credentialForm.categoryId,
        name: credentialForm.name.trim(),
        username: credentialForm.username.trim(),
        url: credentialForm.url.trim(),
        notes: credentialForm.notes.trim(),
        ...(credentialForm.password ? { password: credentialForm.password } : {}),
      };
      if (credentialForm.id) await updatePasswordVaultCredential(payload, sessionToken);
      else await createPasswordVaultCredential(payload, sessionToken);
      setCredentialModal(false);
      setMessage(credentialForm.id ? 'La credencial se actualizó correctamente.' : 'La credencial se guardó de forma cifrada.');
      await load({ preserveMessage: true });
    } catch (saveError) {
      setModalError(saveError.message || 'No se pudo guardar la credencial.');
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(category) {
    if (!window.confirm(`¿Eliminar la categoría “${category.name}”? Solo se permite cuando no contiene credenciales activas.`)) return;
    setBusy(true);
    setError('');
    try {
      await deletePasswordVaultCategory(category.id, sessionToken);
      setMessage('La categoría se eliminó correctamente.');
      await load({ preserveMessage: true });
    } catch (removeError) {
      setError(removeError.message || 'No se pudo eliminar la categoría.');
    } finally {
      setBusy(false);
    }
  }

  async function removeCredential(item) {
    if (!window.confirm(`¿Eliminar la credencial “${item.name}” de ${item.clientName}?`)) return;
    setBusy(true);
    setError('');
    try {
      await deletePasswordVaultCredential(item.id, sessionToken);
      setRevealed((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setMessage('La credencial se eliminó correctamente.');
      await load({ preserveMessage: true });
    } catch (removeError) {
      setError(removeError.message || 'No se pudo eliminar la credencial.');
    } finally {
      setBusy(false);
    }
  }

  async function reveal(item) {
    if (revealed[item.id]?.password) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      return null;
    }
    try {
      const result = await revealPasswordVaultCredential(item.id, sessionToken);
      setRevealed((current) => ({ ...current, [item.id]: result }));
      window.setTimeout(() => {
        setRevealed((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }, Number(result.expiresInSeconds || 30) * 1000);
      return result.password;
    } catch (revealError) {
      setError(revealError.message || 'No se pudo mostrar la contraseña.');
      return null;
    }
  }

  async function copyPassword(item) {
    const password = revealed[item.id]?.password || await reveal(item);
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setMessage(`Contraseña de “${item.name}” copiada. Se mantendrá visible solo temporalmente.`);
    } catch {
      setError('No se pudo copiar automáticamente. Revele la contraseña y cópiela manualmente.');
    }
  }

  const visibleClients = data.clients.filter((client) => !clientFilter || client.id === clientFilter);

  return <div className="page password-vault-page">
    <header className="password-vault-heading">
      <div><span className="eyebrow">Seguridad operativa</span><h1>Contraseñas de clientes</h1><p>Credenciales cifradas y agrupadas por cliente y categoría. Las contraseñas permanecen ocultas hasta que se solicitan.</p></div>
      {canManage && <div><button type="button" className="button button--secondary button--compact" onClick={openNewCategory}><Icon name="create_new_folder" />Nueva categoría</button><button type="button" className="button button--primary button--compact" onClick={() => openNewCredential()}><Icon name="add" />Nueva credencial</button></div>}
    </header>

    <section className="password-vault-security-note"><Icon name="shield_lock" /><div><strong>Cifrado y auditoría</strong><span>Las contraseñas se cifran con AES-256-GCM. Cada revelado queda registrado y se oculta automáticamente al cambiar de pantalla o después de 30 segundos.</span></div></section>

    {!canManage && <div className="readonly-notice"><Icon name="visibility" /><span>Modo consulta: puede buscar, revelar y copiar credenciales. Solo los administradores pueden crear, editar o eliminar categorías y contraseñas.</span></div>}
    {!data.encryptionConfigured && <div className="password-vault-alert is-error"><Icon name="key_off" /><span>El servidor no tiene configurada PASSWORD_VAULT_ENCRYPTION_KEY. No se podrán crear ni revelar credenciales hasta configurarla.</span></div>}
    {error && <div className="password-vault-alert is-error"><Icon name="error" /><span>{error}</span></div>}
    {message && <div className="password-vault-alert is-success"><Icon name="check_circle" /><span>{message}</span></div>}

    <section className="password-vault-toolbar">
      <label><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, categoría, sistema, usuario, URL o nota..." /></label>
      <select value={clientFilter} onChange={(event) => changeClientFilter(event.target.value)}><option value="">Todos los clientes</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.credentialCount})</option>)}</select>
      <button type="button" className="button button--secondary button--compact" onClick={() => load()} disabled={loading}><Icon name={loading ? 'progress_activity' : 'refresh'} />Actualizar</button>
    </section>

    {canManage && <section className={`password-vault-category-manager${categoryManagerOpen ? ' is-open' : ''}`}>
      <button type="button" className="password-vault-accordion-trigger" aria-expanded={categoryManagerOpen} onClick={() => setCategoryManagerOpen((current) => !current)}><span><Icon name="category" /><span><strong>Administrar categorías</strong><small>{data.categories.length} categorías configuradas</small></span></span><Icon name={categoryManagerOpen ? 'expand_less' : 'expand_more'} /></button>
      {categoryManagerOpen && <div className="password-vault-category-manager__body">{data.categories.map((category) => <article key={category.id}><div><strong>{category.name}</strong><span>{category.description || 'Sin descripción'}</span><small>{category.credentialCount} credencial{category.credentialCount === 1 ? '' : 'es'}</small></div><button type="button" onClick={() => openEditCategory(category)} title="Editar"><Icon name="edit" /></button><button type="button" onClick={() => removeCategory(category)} title="Eliminar" disabled={category.credentialCount > 0 || busy}><Icon name="delete" /></button></article>)}{!data.categories.length && <p>No hay categorías. Cree la primera antes de guardar una credencial.</p>}</div>}
    </section>}

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando credenciales cifradas...</div> : <section className="password-vault-client-list">
      {visibleClients.map((client) => {
        const byCategory = grouped.get(client.id) || new Map();
        const count = [...byCategory.values()].reduce((sum, rows) => sum + rows.length, 0);
        const clientOpen = Boolean(search) || openClients.has(client.id) || Boolean(clientFilter);
        return <article key={client.id} className={`password-vault-client${clientOpen ? ' is-open' : ''}`}>
          <button type="button" className="password-vault-accordion-trigger" aria-expanded={clientOpen} onClick={() => toggleSet(setOpenClients, client.id)}><span><Icon name="corporate_fare" /><span><strong>{client.name}</strong><small>{count} credencial{count === 1 ? '' : 'es'} visible{count === 1 ? '' : 's'}</small></span></span><span className="password-vault-accordion-trigger__right">{canManage && <button type="button" onClick={(event) => { event.stopPropagation(); openNewCredential(client.id); }} title={`Agregar credencial a ${client.name}`}><Icon name="add" /></button>}<Icon name={clientOpen ? 'expand_less' : 'expand_more'} /></span></button>
          {clientOpen && <div className="password-vault-client__body">{[...byCategory.entries()].map(([categoryId, rows]) => {
            const category = data.categories.find((item) => item.id === categoryId);
            const categoryOpen = Boolean(search) || openCategories.has(`${client.id}:${categoryId}`) || byCategory.size === 1;
            return <section key={categoryId} className={`password-vault-category-group${categoryOpen ? ' is-open' : ''}`}>
              <button type="button" className="password-vault-category-trigger" aria-expanded={categoryOpen} onClick={() => toggleSet(setOpenCategories, `${client.id}:${categoryId}`)}><span><Icon name="folder" /><strong>{category?.name || rows[0]?.categoryName || 'Sin categoría'}</strong><small>{rows.length}</small></span><Icon name={categoryOpen ? 'expand_less' : 'expand_more'} /></button>
              {categoryOpen && <div className="password-vault-credential-grid">{rows.map((item) => <CredentialCard key={item.id} item={item} canManage={canManage} revealed={revealed[item.id]} onReveal={reveal} onCopy={copyPassword} onEdit={openEditCredential} onDelete={removeCredential} />)}</div>}
            </section>;
          })}{!count && <div className="password-vault-empty"><Icon name="key_off" /><strong>Sin credenciales</strong><span>{search ? 'No existen coincidencias para esta búsqueda.' : 'Este cliente todavía no tiene contraseñas guardadas.'}</span>{canManage && <button type="button" className="button button--primary button--compact" onClick={() => openNewCredential(client.id)}><Icon name="add" />Agregar credencial</button>}</div>}</div>}
        </article>;
      })}
      {!visibleClients.length && <div className="password-vault-empty"><Icon name="search_off" /><strong>Cliente no disponible</strong><span>El filtro seleccionado ya no existe o no está activo.</span></div>}
    </section>}

    <PasswordVaultModal open={categoryModal} title={categoryForm.id ? 'Editar categoría' : 'Nueva categoría'} subtitle="Las categorías agrupan cualquier cantidad de credenciales en todos los clientes." icon="category" busy={busy} onClose={() => !busy && setCategoryModal(false)}><CategoryForm form={categoryForm} setForm={setCategoryForm} busy={busy} error={modalError} onSubmit={saveCategory} onCancel={() => setCategoryModal(false)} /></PasswordVaultModal>
    <PasswordVaultModal open={credentialModal} title={credentialForm.id ? 'Editar credencial' : 'Nueva credencial'} subtitle="La contraseña se cifra en el servidor antes de almacenarse en Google Sheets." icon="key" busy={busy} onClose={() => !busy && setCredentialModal(false)}><CredentialForm form={credentialForm} setForm={setCredentialForm} clients={data.clients} categories={data.categories} busy={busy} error={modalError} editing={Boolean(credentialForm.id)} onSubmit={saveCredential} onCancel={() => setCredentialModal(false)} /></PasswordVaultModal>
  </div>;
}
