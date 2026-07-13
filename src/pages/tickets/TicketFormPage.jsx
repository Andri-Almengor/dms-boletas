import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import AutosaveIndicator from '../../components/feedback/AutosaveIndicator';
import DependentSelect from '../../components/forms/DependentSelect';
import EvidenceUploader from '../../components/forms/EvidenceUploader';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import TechnicianMultiSelect from '../../components/forms/TechnicianMultiSelect';
import SignaturePad from '../../components/tickets/SignaturePad';
import TechnicalWritingAssistant from '../../components/tickets/TechnicalWritingAssistant';
import useTicketDraft from '../../hooks/useTicketDraft';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean, toOption } from '../../services/moduleApi';

const STEPS = [
  ['Información general', 'Título, categoría, tipo de falla, fecha y horas.'],
  ['Cliente y ubicación', 'Cliente, ubicación, supervisor y correos.'],
  ['Dispositivo', 'Tipo, fabricante, modelo, serie y descripción.'],
  ['Trabajo realizado', 'Motivo, pruebas, resultado y recomendaciones.'],
  ['Técnicos', 'Seleccione una o varias personas asignadas.'],
  ['Evidencias', 'Capture fotografías o seleccione archivos.'],
  ['Firma', 'Firma de conformidad con dedo, mouse o lápiz.'],
  ['Revisión y envío', 'Confirme los datos y elija la acción final.'],
];

const EMPTY = {
  titulo: '', categoriaId: '', categoria: '', tipoFallaId: '', tipoFalla: '',
  fecha: new Date().toISOString().slice(0, 10), horaInicio: '', horaFinal: '', horasTotales: '0.00',
  clienteId: '', cliente: '', ubicacionId: '', ubicacion: '', ubicacionEquipoId: '', ubicacionEquipo: '',
  supervisorId: '', supervisor: '', correoSupervisor: '', correoCliente: '',
  tipoDispositivoId: '', tipoDispositivo: '', fabricanteId: '', fabricante: '', modeloId: '', modelo: '',
  serie: '', descripcionEquipo: '', razonVisita: '', descripcion: '', pruebasRealizadas: '', resultado: '', recomendaciones: '',
  asignados: [], firma: '', enviarCorreoCliente: false, correosCC: '',
};

const ids = {
  clients: ['ClienteID', 'ID', 'id'], categories: ['CategoriaID', 'ID', 'id'], failures: ['TipoFallaID', 'ID', 'id'],
  devices: ['TipoDispositivoID', 'ID', 'id'], manufacturers: ['FabricanteID', 'ID', 'id'], models: ['ModeloID', 'ID', 'id'],
};

function hours(start, end) {
  if (!start || !end) return '0.00';
  const [a, b] = start.split(':').map(Number); const [c, d] = end.split(':').map(Number);
  if ([a, b, c, d].some(Number.isNaN)) return '0.00';
  let minutes = c * 60 + d - (a * 60 + b); if (minutes < 0) minutes += 1440;
  return (minutes / 60).toFixed(2);
}

function Field({ label, multiline, hint, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="5" {...props} /> : <input className="form-control" {...props} />}{hint && <small className="field-hint">{hint}</small>}</label>;
}

function options(rows, valueKeys, labelKeys) { return rows.map((row) => toOption(row, valueKeys, labelKeys)).filter(Boolean); }
function find(rows, value, keys) { return rows.find((row) => keys.some((key) => String(row?.[key] || '') === String(value || ''))); }
function recordData(data) { return data?.boleta || data?.ticket || data || {}; }
function mapForm(data) {
  const row = recordData(data);
  return { ...EMPTY,
    titulo: pick(row, ['Titulo', 'Título']), categoriaId: String(pick(row, ['CategoriaID'])), categoria: pick(row, ['Categoria']),
    tipoFallaId: String(pick(row, ['TipoFallaID'])), tipoFalla: pick(row, ['TipoFalla']), fecha: String(pick(row, ['Fecha'], EMPTY.fecha)).slice(0, 10),
    horaInicio: pick(row, ['HoraInicio']), horaFinal: pick(row, ['HoraFinal']), horasTotales: String(pick(row, ['HorasTotales'], '0.00')),
    clienteId: String(pick(row, ['ClienteID'])), cliente: pick(row, ['Cliente']), ubicacionId: String(pick(row, ['UbicacionID'])), ubicacion: pick(row, ['Ubicacion']),
    ubicacionEquipoId: String(pick(row, ['UbicacionEquipoID'])), ubicacionEquipo: pick(row, ['UbicacionEquipo']), supervisorId: String(pick(row, ['SupervisorID'])), supervisor: pick(row, ['Supervisor']),
    correoSupervisor: pick(row, ['CorreoSupervisor']), correoCliente: pick(row, ['CorreoCliente', 'Correo_Cliente']), tipoDispositivoId: String(pick(row, ['TipoDispositivoID'])), tipoDispositivo: pick(row, ['TipoDispositivo']),
    fabricanteId: String(pick(row, ['FabricanteID'])), fabricante: pick(row, ['Fabricante']), modeloId: String(pick(row, ['ModeloID'])), modelo: pick(row, ['Modelo']), serie: pick(row, ['Serie']),
    descripcionEquipo: pick(row, ['DescripcionEquipo', 'NombreEquipo']), razonVisita: pick(row, ['RazonVisita', 'Razon_visita']), descripcion: pick(row, ['Descripcion', 'Descripción']),
    pruebasRealizadas: pick(row, ['PruebasRealizadas']), resultado: pick(row, ['Resultado']), recomendaciones: pick(row, ['Recomendaciones']),
    asignados: (data?.asignados || row.asignados || []).map((item) => String(pick(item, ['UsuarioID', 'value'], item))).filter(Boolean),
    enviarCorreoCliente: toBoolean(pick(row, ['EnviarCorreoCliente'], false)), correosCC: pick(row, ['CorreosCC']),
  };
}

function payload(form, boletaUid, estado = 'PENDIENTE') {
  return { boletaUid, estado, ...form, horasTotales: Number(form.horasTotales || 0),
    Titulo: form.titulo, CategoriaID: form.categoriaId, Categoria: form.categoria, TipoFallaID: form.tipoFallaId, TipoFalla: form.tipoFalla,
    Fecha: form.fecha, HoraInicio: form.horaInicio, HoraFinal: form.horaFinal, HorasTotales: Number(form.horasTotales || 0),
    ClienteID: form.clienteId, Cliente: form.cliente, UbicacionID: form.ubicacionId, Ubicacion: form.ubicacion,
    UbicacionEquipoID: form.ubicacionEquipoId, UbicacionEquipo: form.ubicacionEquipo, SupervisorID: form.supervisorId, Supervisor: form.supervisor,
    CorreoSupervisor: form.correoSupervisor, CorreoCliente: form.correoCliente, TipoDispositivoID: form.tipoDispositivoId, TipoDispositivo: form.tipoDispositivo,
    FabricanteID: form.fabricanteId, Fabricante: form.fabricante, ModeloID: form.modeloId, Modelo: form.modelo, Serie: form.serie,
    RazonVisita: form.razonVisita, Descripcion: form.descripcion || form.descripcionEquipo, PruebasRealizadas: form.pruebasRealizadas,
    Resultado: form.resultado, Recomendaciones: form.recomendaciones, AsignadoA: form.asignados, EnviarCorreoCliente: form.enviarCorreoCliente,
    CorreosCC: form.correosCC, Estado: estado,
  };
}

async function base64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); }); }

export default function TicketFormPage({ mode = 'create' }) {
  const { boletaUid } = useParams();
  const { sessionToken, user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const editing = mode === 'edit';
  const allowed = editing ? hasPermission('BOLETAS_EDITAR') : hasPermission('BOLETAS_CREAR');
  const manageCatalogs = hasPermission('CATALOGOS_GESTIONAR') || hasPermission('BOLETAS_CREAR') || hasPermission('BOLETAS_EDITAR');
  const createOperational = hasPermission('CLIENTES_DATOS_OPERATIVOS_CREAR') || hasPermission('CLIENTES_EDITAR');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ ...EMPTY, asignados: user?.UsuarioID ? [String(user.UsuarioID)] : [] });
  const [catalogs, setCatalogs] = useState({ clients: [], categories: [], failures: [], devices: [], manufacturers: [], models: [], relations: [], users: [] });
  const [locations, setLocations] = useState([]); const [equipmentLocations, setEquipmentLocations] = useState([]); const [contacts, setContacts] = useState([]);
  const [evidences, setEvidences] = useState([]); const [existingEvidenceCount, setExistingEvidenceCount] = useState(0);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [serverStatus, setServerStatus] = useState('idle'); const [error, setError] = useState('');
  const [modal, setModal] = useState(null); const [modalError, setModalError] = useState(''); const [modalSaving, setModalSaving] = useState(false);

  const restore = useCallback((draftData) => { if (draftData.form) setForm((current) => ({ ...current, ...draftData.form })); if (Number.isInteger(draftData.step)) setStep(draftData.step); }, []);
  const draft = useTicketDraft({ keySuffix: editing ? boletaUid : 'new', enabled: !loading, value: { form, step }, onRestore: restore });
  const autosaveStatus = editing && serverStatus !== 'idle' ? serverStatus : draft.status;

  async function loadCatalogs() {
    const jobs = [
      ['clients', MODULE_ROUTES.clients.list], ['categories', MODULE_ROUTES.categories.list], ['failures', MODULE_ROUTES.failureTypes.list],
      ['devices', MODULE_ROUTES.deviceTypes.list], ['manufacturers', MODULE_ROUTES.manufacturers.list], ['models', MODULE_ROUTES.models.list],
      ['relations', MODULE_ROUTES.deviceManufacturers.list], ['users', MODULE_ROUTES.users.list],
    ];
    const results = await Promise.allSettled(jobs.map(([, routes]) => requestAvailable(routes, { page: 1, pageSize: 1000, activo: true }, sessionToken)));
    const next = {}; const failures = [];
    results.forEach((result, index) => result.status === 'fulfilled' ? next[jobs[index][0]] = normalizeItems(result.value) : failures.push(result.reason?.message));
    next.users = (next.users || []).filter((item) => String(pick(item, ['Estado'], 'ACTIVO')).toUpperCase() === 'ACTIVO');
    setCatalogs((current) => ({ ...current, ...next }));
    if (failures.length) setError(`Algunos catálogos no se cargaron: ${failures.filter(Boolean).join(' · ')}`);
    requestAvailable(MODULE_ROUTES.config.get, {}, sessionToken).then((cfg) => setForm((current) => ({ ...current, correosCC: current.correosCC || pick(cfg, ['DEFAULT_CC_EMAILS', 'defaultCcEmails'], '') }))).catch(() => {});
  }

  useEffect(() => {
    let active = true; setLoading(true);
    Promise.all([loadCatalogs(), editing ? requestAvailable(MODULE_ROUTES.tickets.get, { boletaUid }, sessionToken) : Promise.resolve(null)])
      .then(([, data]) => { if (!active || !data) return; setForm(mapForm(data)); setExistingEvidenceCount((data.evidencias || []).length); })
      .catch((err) => active && setError(err.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [editing, boletaUid, sessionToken]);

  useEffect(() => {
    if (!form.clienteId) { setLocations([]); setContacts([]); return; }
    Promise.allSettled([
      requestAvailable(MODULE_ROUTES.clients.locationsList, { clienteId: form.clienteId, activo: true, pageSize: 500 }, sessionToken),
      requestAvailable(MODULE_ROUTES.clients.contactsList, { clienteId: form.clienteId, activo: true, esSupervisor: true, pageSize: 500 }, sessionToken),
    ]).then(([a, b]) => { if (a.status === 'fulfilled') setLocations(normalizeItems(a.value)); if (b.status === 'fulfilled') setContacts(normalizeItems(b.value)); });
  }, [form.clienteId, sessionToken]);
  useEffect(() => { if (!form.ubicacionId) { setEquipmentLocations([]); return; } requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, { ubicacionId: form.ubicacionId, activo: true, pageSize: 500 }, sessionToken).then((data) => setEquipmentLocations(normalizeItems(data))).catch((err) => setError(err.message)); }, [form.ubicacionId, sessionToken]);
  useEffect(() => { const total = hours(form.horaInicio, form.horaFinal); setForm((current) => current.horasTotales === total ? current : { ...current, horasTotales: total }); }, [form.horaInicio, form.horaFinal]);
  useEffect(() => {
    if (!editing || loading) return undefined; setServerStatus('saving');
    const timer = setTimeout(() => requestAvailable(MODULE_ROUTES.tickets.autosave, payload(form, boletaUid), sessionToken).then(() => setServerStatus('server')).catch(() => setServerStatus('error')), 1800);
    return () => clearTimeout(timer);
  }, [editing, loading, boletaUid, form, sessionToken]);

  const opt = {
    clients: options(catalogs.clients, ids.clients, ['Nombre', 'Clientes', 'RazonSocial']), categories: options(catalogs.categories, ids.categories, ['Nombre']), failures: options(catalogs.failures, ids.failures, ['Nombre']),
    devices: options(catalogs.devices, ids.devices, ['Nombre']), locations: options(locations, ['UbicacionID', 'id'], ['Nombre']), equipment: options(equipmentLocations, ['UbicacionEquipoID', 'id'], ['Nombre']),
    supervisors: contacts.filter((item) => toBoolean(pick(item, ['EsSupervisor'], true), true)).map((item) => { const o = toOption(item, ['ContactoID', 'id'], ['Nombre']); return o ? { ...o, label: `${o.label}${pick(item, ['Correo']) ? ` · ${pick(item, ['Correo'])}` : ''}` } : null; }).filter(Boolean),
  };
  const relationIds = catalogs.relations.filter((item) => String(pick(item, ['TipoDispositivoID'])) === form.tipoDispositivoId && toBoolean(pick(item, ['Activo'], true), true)).map((item) => String(pick(item, ['FabricanteID'])));
  opt.manufacturers = options(relationIds.length ? catalogs.manufacturers.filter((item) => relationIds.includes(String(pick(item, ['FabricanteID'])))) : catalogs.manufacturers, ids.manufacturers, ['Nombre']);
  opt.models = options(catalogs.models.filter((item) => (!form.tipoDispositivoId || String(pick(item, ['TipoDispositivoID'])) === form.tipoDispositivoId) && (!form.fabricanteId || String(pick(item, ['FabricanteID'])) === form.fabricanteId)), ids.models, ['Nombre']);
  const technicians = catalogs.users.map((item) => { const label = pick(item, ['NombreCompleto', 'Nombre']); const parts = label.split(/\s+/); return { value: String(pick(item, ['UsuarioID', 'id'])), label, note: pick(item, ['Correo', 'NombreUsuario']), initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() }; }).filter((item) => item.value && item.label);

  function update(event) { const { name, value, type, checked } = event.target; setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value })); }
  function choose(event, rows, idKeys, idField, nameField, nameKeys, reset = {}, extra) { const value = event.target.value; const row = find(rows, value, idKeys); setForm((current) => ({ ...current, [idField]: value, [nameField]: pick(row, nameKeys, ''), ...reset, ...(extra ? extra(row) : {}) })); }
  function addFiles(event) { const files = Array.from(event.target.files || []); setEvidences((current) => [...current, ...files.map((file) => ({ localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, file, name: file.name, note: '', mimeType: file.type || 'application/octet-stream', previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' }))]); event.target.value = ''; }
  function validate(index) { if (index === 0 && (!form.titulo || !form.categoriaId || !form.tipoFallaId || !form.fecha)) return 'Complete título, categoría, tipo de falla y fecha.'; if (index === 1 && !form.clienteId) return 'Seleccione un cliente.'; if (index === 2 && !form.tipoDispositivoId) return 'Seleccione el tipo de dispositivo.'; if (index === 4 && !form.asignados.length) return 'Seleccione al menos un técnico.'; return ''; }
  function next() { const message = validate(step); if (message) return setError(message); setError(''); setStep((value) => Math.min(7, value + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  async function uploadAssets(uid) {
    if (form.firma?.startsWith('data:image/')) await requestAvailable(['boletas.signature.upload'], { boletaUid: uid, base64: form.firma.split(',')[1], mimeType: 'image/png', fileName: `firma_boleta_${uid}.png` }, sessionToken);
    for (const item of evidences) await requestAvailable(MODULE_ROUTES.tickets.evidenceUpload, { boletaUid: uid, nombre: item.name || item.file.name, nota: item.note, fileName: item.file.name, mimeType: item.mimeType, base64: await base64(item.file) }, sessionToken);
  }
  async function saveBase() { const result = await requestAvailable(editing ? MODULE_ROUTES.tickets.update : MODULE_ROUTES.tickets.create, payload(form, boletaUid), sessionToken); const uid = pick(recordData(result), ['BoletaUID', 'boletaUid', 'TicketUID', 'id'], boletaUid); if (!uid) throw new Error('El backend no devolvió BoletaUID.'); await uploadAssets(uid); return uid; }
  async function action(type) {
    const message = STEPS.map((_, index) => validate(index)).find(Boolean); if (message) return setError(message);
    if (['finalize', 'test'].includes(type) && !form.firma && !editing) return setError('Registre la firma antes de continuar.');
    setSaving(true); setError('');
    try { const uid = await saveBase(); if (type === 'finalize') await requestAvailable(MODULE_ROUTES.tickets.finalize, { boletaUid: uid, sendClientCopy: form.enviarCorreoCliente, cc: form.correosCC }, sessionToken); if (type === 'test') await requestAvailable(MODULE_ROUTES.tickets.testFinalize, { boletaUid: uid, testMode: true }, sessionToken); if (type === 'pdf') await requestAvailable(MODULE_ROUTES.tickets.generatePdf, { boletaUid: uid }, sessionToken); draft.clearDraft(); navigate(`/boletas/${encodeURIComponent(uid)}`); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  function openModal(type) { setModal({ type, values: { nombre: '', descripcion: '', correo: '', puesto: '', telefono: '', direccion: '', notas: '', imagenReferenciaURL: '' } }); setModalError(''); }
  function modalUpdate(event) { setModal((current) => ({ ...current, values: { ...current.values, [event.target.name]: event.target.value } })); }
  async function submitModal(event) {
    event.preventDefault(); const { type, values } = modal; if (!values.nombre.trim()) return setModalError('El nombre es obligatorio.'); setModalSaving(true); setModalError('');
    try {
      let result;
      if (type === 'location') result = await requestAvailable(MODULE_ROUTES.clients.locationsCreate, { clienteId: form.clienteId, nombre: values.nombre, direccion: values.direccion, notas: values.notas, activo: true }, sessionToken);
      if (type === 'equipment') result = await requestAvailable(MODULE_ROUTES.clients.equipmentLocationsCreate, { ubicacionId: form.ubicacionId, nombre: values.nombre, descripcion: values.descripcion, activo: true }, sessionToken);
      if (type === 'supervisor') result = await requestAvailable(MODULE_ROUTES.clients.contactsCreate, { clienteId: form.clienteId, nombre: values.nombre, correo: values.correo, puesto: values.puesto, telefono: values.telefono, esSupervisor: true, recibeCorreo: true, activo: true }, sessionToken);
      if (type === 'category') result = await requestAvailable(MODULE_ROUTES.categories.create, { nombre: values.nombre, descripcion: values.descripcion, activo: true }, sessionToken);
      if (type === 'failure') result = await requestAvailable(MODULE_ROUTES.failureTypes.create, { nombre: values.nombre, descripcion: values.descripcion, activo: true }, sessionToken);
      if (type === 'device') result = await requestAvailable(MODULE_ROUTES.deviceTypes.create, { nombre: values.nombre, descripcion: values.descripcion, activo: true }, sessionToken);
      if (type === 'manufacturer') { result = await requestAvailable(MODULE_ROUTES.manufacturers.create, { nombre: values.nombre, activo: true }, sessionToken); await requestAvailable(MODULE_ROUTES.deviceManufacturers.create, { tipoDispositivoId: form.tipoDispositivoId, fabricanteId: pick(result, ['FabricanteID', 'id']), activo: true }, sessionToken); }
      if (type === 'model') result = await requestAvailable(MODULE_ROUTES.models.create, { tipoDispositivoId: form.tipoDispositivoId, fabricanteId: form.fabricanteId, nombre: values.nombre, descripcion: values.descripcion, imagenReferenciaURL: values.imagenReferenciaURL, activo: true }, sessionToken);
      if (type === 'location') { setLocations((rows) => [...rows, result]); setForm((current) => ({ ...current, ubicacionId: String(pick(result, ['UbicacionID', 'id'])), ubicacion: pick(result, ['Nombre']) })); }
      else if (type === 'equipment') { setEquipmentLocations((rows) => [...rows, result]); setForm((current) => ({ ...current, ubicacionEquipoId: String(pick(result, ['UbicacionEquipoID', 'id'])), ubicacionEquipo: pick(result, ['Nombre']) })); }
      else if (type === 'supervisor') { setContacts((rows) => [...rows, result]); setForm((current) => ({ ...current, supervisorId: String(pick(result, ['ContactoID', 'id'])), supervisor: pick(result, ['Nombre']), correoSupervisor: pick(result, ['Correo'], values.correo) })); }
      else { await loadCatalogs(); const keyMap = { category: ['categoriaId', 'categoria', 'CategoriaID'], failure: ['tipoFallaId', 'tipoFalla', 'TipoFallaID'], device: ['tipoDispositivoId', 'tipoDispositivo', 'TipoDispositivoID'], manufacturer: ['fabricanteId', 'fabricante', 'FabricanteID'], model: ['modeloId', 'modelo', 'ModeloID'] }; const [idField, nameField, idKey] = keyMap[type]; setForm((current) => ({ ...current, [idField]: String(pick(result, [idKey, 'id'])), [nameField]: pick(result, ['Nombre']) })); }
      setModal(null);
    } catch (err) { setModalError(err.message); } finally { setModalSaving(false); }
  }

  if (!allowed) return <Navigate to="/boletas/pendientes" replace />;
  if (loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando formulario...</div></div>;
  const progress = Math.round(((step + 1) / 8) * 100);
  const selectedNames = technicians.filter((item) => form.asignados.includes(item.value)).map((item) => item.label).join(', ');

  return <div className="page page--narrow ticket-form-page">
    <div className="page-header ticket-form-header"><button className="icon-button" type="button" onClick={() => navigate(editing ? `/boletas/${encodeURIComponent(boletaUid)}` : '/boletas/pendientes')}><Icon name="close" /></button><div><span className="eyebrow">Flujo de trabajo</span><h1>{editing ? 'Editar Boleta' : 'Crear Boleta'}</h1></div><AutosaveIndicator status={autosaveStatus} /></div>
    <section className="ticket-progress"><div><strong>Paso {step + 1} de 8</strong><span>{progress}% completado</span></div><div className="ticket-progress__track"><span style={{ width: `${progress}%` }} /></div></section>
    <section className="form-card ticket-form-card"><div className="form-card__heading"><span className="section-marker" /><div><h2>Paso {step + 1}: {STEPS[step][0]}</h2><p>{STEPS[step][1]}</p></div></div>{error && <div className="alert alert--error"><Icon name="error" /> {error}</div>}<div className="stack-form">
      {step === 0 && <><Field label="Título" name="titulo" value={form.titulo} onChange={update} required /><div className="ticket-form-grid"><DependentSelect label="Categoría" name="categoriaId" value={form.categoriaId} options={opt.categories} required canAdd={manageCatalogs} onAdd={() => openModal('category')} onChange={(e) => choose(e, catalogs.categories, ids.categories, 'categoriaId', 'categoria', ['Nombre'])} /><DependentSelect label="Tipo de falla" name="tipoFallaId" value={form.tipoFallaId} options={opt.failures} required canAdd={manageCatalogs} onAdd={() => openModal('failure')} onChange={(e) => choose(e, catalogs.failures, ids.failures, 'tipoFallaId', 'tipoFalla', ['Nombre'])} /></div><div className="ticket-form-grid ticket-form-grid--three"><Field label="Fecha" type="date" name="fecha" value={form.fecha} onChange={update} /><Field label="Hora inicio" type="time" name="horaInicio" value={form.horaInicio} onChange={update} /><Field label="Hora final" type="time" name="horaFinal" value={form.horaFinal} onChange={update} /></div><Field label="Horas totales" type="number" step="0.01" name="horasTotales" value={form.horasTotales} onChange={update} hint="Cálculo automático, incluso cruzando medianoche." /></>}
      {step === 1 && <><DependentSelect label="Cliente" name="clienteId" value={form.clienteId} options={opt.clients} required onChange={(e) => choose(e, catalogs.clients, ids.clients, 'clienteId', 'cliente', ['Nombre', 'Clientes'], { ubicacionId: '', ubicacion: '', ubicacionEquipoId: '', ubicacionEquipo: '', supervisorId: '', supervisor: '', correoSupervisor: '' }, (row) => ({ correoCliente: pick(row, ['CorreoGeneral', 'Correo']) }))} /><div className="ticket-form-grid"><DependentSelect label="Ubicación" name="ubicacionId" value={form.ubicacionId} options={opt.locations} disabled={!form.clienteId} canAdd={createOperational && Boolean(form.clienteId)} onAdd={() => openModal('location')} onChange={(e) => choose(e, locations, ['UbicacionID', 'id'], 'ubicacionId', 'ubicacion', ['Nombre'], { ubicacionEquipoId: '', ubicacionEquipo: '' })} /><DependentSelect label="Ubicación del equipo" name="ubicacionEquipoId" value={form.ubicacionEquipoId} options={opt.equipment} disabled={!form.ubicacionId} canAdd={createOperational && Boolean(form.ubicacionId)} onAdd={() => openModal('equipment')} onChange={(e) => choose(e, equipmentLocations, ['UbicacionEquipoID', 'id'], 'ubicacionEquipoId', 'ubicacionEquipo', ['Nombre'])} /></div><DependentSelect label="Supervisor" name="supervisorId" value={form.supervisorId} options={opt.supervisors} disabled={!form.clienteId} canAdd={createOperational && Boolean(form.clienteId)} onAdd={() => openModal('supervisor')} onChange={(e) => choose(e, contacts, ['ContactoID', 'id'], 'supervisorId', 'supervisor', ['Nombre'], {}, (row) => ({ correoSupervisor: pick(row, ['Correo']) }))} /><div className="ticket-form-grid"><Field label="Correo supervisor" type="email" name="correoSupervisor" value={form.correoSupervisor} onChange={update} readOnly={!hasPermission('CLIENTES_EDITAR')} /><Field label="Correo cliente" type="email" name="correoCliente" value={form.correoCliente} onChange={update} readOnly={!hasPermission('CLIENTES_EDITAR')} /></div></>}
      {step === 2 && <><DependentSelect label="Tipo de dispositivo" name="tipoDispositivoId" value={form.tipoDispositivoId} options={opt.devices} required canAdd={manageCatalogs} onAdd={() => openModal('device')} onChange={(e) => choose(e, catalogs.devices, ids.devices, 'tipoDispositivoId', 'tipoDispositivo', ['Nombre'], { fabricanteId: '', fabricante: '', modeloId: '', modelo: '' })} /><div className="ticket-form-grid"><DependentSelect label="Fabricante" name="fabricanteId" value={form.fabricanteId} options={opt.manufacturers} disabled={!form.tipoDispositivoId} canAdd={manageCatalogs && Boolean(form.tipoDispositivoId)} onAdd={() => openModal('manufacturer')} onChange={(e) => choose(e, catalogs.manufacturers, ids.manufacturers, 'fabricanteId', 'fabricante', ['Nombre'], { modeloId: '', modelo: '' })} /><DependentSelect label="Modelo" name="modeloId" value={form.modeloId} options={opt.models} disabled={!form.tipoDispositivoId || !form.fabricanteId} canAdd={manageCatalogs && Boolean(form.fabricanteId)} onAdd={() => openModal('model')} onChange={(e) => choose(e, catalogs.models, ids.models, 'modeloId', 'modelo', ['Nombre'])} /></div><Field label="Serie" name="serie" value={form.serie} onChange={update} /><Field label="Descripción o nombre del equipo" multiline name="descripcionEquipo" value={form.descripcionEquipo} onChange={update} /></>}
      {step === 3 && <><TechnicalWritingAssistant form={form} setForm={setForm} disabled={saving} /><Field label="Razón de visita" multiline name="razonVisita" value={form.razonVisita} onChange={update} /><Field label="Descripción" multiline name="descripcion" value={form.descripcion} onChange={update} /><Field label="Pruebas realizadas" multiline name="pruebasRealizadas" value={form.pruebasRealizadas} onChange={update} /><Field label="Resultado" multiline name="resultado" value={form.resultado} onChange={update} /><Field label="Recomendaciones" multiline name="recomendaciones" value={form.recomendaciones} onChange={update} /></>}
      {step === 4 && <TechnicianMultiSelect users={technicians} selectedIds={form.asignados} onChange={(asignados) => setForm((current) => ({ ...current, asignados }))} disabled={saving} />}
      {step === 5 && <EvidenceUploader items={evidences} onAdd={addFiles} onUpdate={(index, patch) => setEvidences((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row))} onRemove={(index) => setEvidences((rows) => rows.filter((_, i) => i !== index))} disabled={saving} />}
      {step === 6 && <><SignaturePad value={form.firma} onChange={(firma) => setForm((current) => ({ ...current, firma }))} />{editing && !form.firma && <div className="info-box"><Icon name="info" /><p>La firma existente se conserva si no dibuja una nueva.</p></div>}</>}
      {step === 7 && <><div className="ticket-review-list">{[['Cliente', form.cliente], ['Ubicación', [form.ubicacion, form.ubicacionEquipo].filter(Boolean).join(' · ')], ['Supervisor', form.supervisor], ['Dispositivo', [form.tipoDispositivo, form.fabricante, form.modelo, form.serie].filter(Boolean).join(' · ')], ['Técnicos', selectedNames], ['Evidencias', `${existingEvidenceCount + evidences.length} archivo(s)`], ['Categoría', form.categoria], ['Tipo de falla', form.tipoFalla], ['Resultado', form.resultado]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || 'Sin especificar'}</strong></div>)}</div><label className="check-card"><input type="checkbox" name="enviarCorreoCliente" checked={form.enviarCorreoCliente} onChange={update} /><Icon name={form.enviarCorreoCliente ? 'check_box' : 'check_box_outline_blank'} /><div><strong>Enviar copia al cliente</strong><small>Incluye al cliente en la notificación final.</small></div></label><Field label="Correos CC" name="correosCC" value={form.correosCC} onChange={update} hint="Separe varios correos con coma." /><div className="review-action-grid"><button className="button button--secondary" type="button" onClick={() => action('pdf')} disabled={saving}><Icon name="picture_as_pdf" /> Generar PDF</button>{hasPermission('NOTIFICACIONES_PRUEBA') && <button className="button button--secondary" type="button" onClick={() => action('test')} disabled={saving}><Icon name="science" /> Probar PDF, Chat y correo</button>}{hasPermission('BOLETAS_FINALIZAR') && <button className="button button--primary" type="button" onClick={() => action('finalize')} disabled={saving}><Icon name="task_alt" /> Finalizar</button>}</div></>}
    </div></section>
    <div className="ticket-form-actions"><button className="button button--secondary" type="button" onClick={() => step ? setStep((value) => value - 1) : navigate('/boletas/pendientes')} disabled={saving}><Icon name={step ? 'chevron_left' : 'close'} /> {step ? 'Anterior' : 'Cancelar'}</button>{step < 7 ? <button className="button button--primary" type="button" onClick={next} disabled={saving}>Siguiente <Icon name="chevron_right" /></button> : <button className="button button--primary" type="button" onClick={() => action('save')} disabled={saving}><Icon name="save" /> {saving ? 'Guardando...' : 'Guardar pendiente'}</button>}</div>
    <InlineCreateModal open={Boolean(modal)} title={`Agregar ${modal?.type || ''}`} description="El registro quedará disponible para futuras boletas." saving={modalSaving} error={modalError} onClose={() => setModal(null)} onSubmit={submitModal}>{modal && <><Field label="Nombre" name="nombre" value={modal.values.nombre} onChange={modalUpdate} required />{modal.type === 'supervisor' && <><Field label="Correo" type="email" name="correo" value={modal.values.correo} onChange={modalUpdate} required /><div className="ticket-form-grid"><Field label="Puesto" name="puesto" value={modal.values.puesto} onChange={modalUpdate} /><Field label="Teléfono" name="telefono" value={modal.values.telefono} onChange={modalUpdate} /></div></>}{modal.type === 'location' && <><Field label="Dirección" name="direccion" value={modal.values.direccion} onChange={modalUpdate} /><Field label="Notas" multiline name="notas" value={modal.values.notas} onChange={modalUpdate} /></>}{['equipment', 'category', 'failure', 'device', 'model'].includes(modal.type) && <Field label="Descripción" multiline name="descripcion" value={modal.values.descripcion} onChange={modalUpdate} />}{modal.type === 'model' && <Field label="Imagen de referencia (URL)" name="imagenReferenciaURL" value={modal.values.imagenReferenciaURL} onChange={modalUpdate} />}</>}</InlineCreateModal>
  </div>;
}
