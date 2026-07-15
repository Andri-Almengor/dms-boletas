import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import TechnicianMultiSelect from '../../components/forms/TechnicianMultiSelect';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const SECTIONS = {
  general: { title: 'Información general', icon: 'description', description: 'Título, categoría, falla, fecha y tiempos.' },
  client: { title: 'Cliente', icon: 'corporate_fare', description: 'Cliente, ubicaciones, supervisor y correos.' },
  device: { title: 'Dispositivo / Equipo', icon: 'devices_other', description: 'Tipo, nombre, fabricante, modelo y serie.' },
  work: { title: 'Trabajo realizado', icon: 'engineering', description: 'Motivo, pruebas, resultado, recomendaciones y técnicos.' },
};

function text(value) {
  return String(value ?? '').trim();
}

function hours(start, end) {
  if (!start || !end) return '0.00';
  const [a, b] = start.split(':').map(Number);
  const [c, d] = end.split(':').map(Number);
  if ([a, b, c, d].some(Number.isNaN)) return '0.00';
  let minutes = c * 60 + d - (a * 60 + b);
  if (minutes < 0) minutes += 1440;
  return (minutes / 60).toFixed(2);
}

function Field({ label, multiline = false, ...props }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea className="form-control ticket-textarea" rows="5" {...props} />
        : <input className="form-control" {...props} />}
    </label>
  );
}

function Select({ label, value, onChange, options, disabled = false, required = false, emptyLabel = 'Seleccione una opción' }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      <select className="form-control" value={value} onChange={onChange} disabled={disabled} required={required}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function optionRows(rows, idKeys, labelKeys) {
  return rows.map((row) => {
    const value = text(pick(row, idKeys));
    const label = text(pick(row, labelKeys));
    return value && label ? { value, label, row } : null;
  }).filter(Boolean);
}

function sameId(left, right) {
  return String(left || '') === String(right || '');
}

function mapForm(data) {
  const row = data?.boleta || data || {};
  return {
    titulo: pick(row, ['Titulo', 'Título']),
    categoriaId: text(pick(row, ['CategoriaID'])),
    categoria: pick(row, ['Categoria', 'Categoría']),
    tipoFallaId: text(pick(row, ['TipoFallaID'])),
    tipoFalla: pick(row, ['TipoFalla']),
    fecha: text(pick(row, ['Fecha'])).slice(0, 10),
    horaInicio: pick(row, ['HoraInicio']),
    horaFinal: pick(row, ['HoraFinal']),
    horasTotales: text(pick(row, ['HorasTotales'], '0.00')),
    clienteId: text(pick(row, ['ClienteID'])),
    cliente: pick(row, ['Cliente', 'ClienteNombre']),
    ubicacionId: text(pick(row, ['UbicacionID'])),
    ubicacion: pick(row, ['Ubicacion', 'Ubicación']),
    ubicacionEquipoId: text(pick(row, ['UbicacionEquipoID'])),
    ubicacionEquipo: pick(row, ['UbicacionEquipo', 'Ubicacion_equipo']),
    supervisorId: text(pick(row, ['SupervisorID'])),
    supervisor: pick(row, ['Supervisor']),
    correoSupervisor: pick(row, ['CorreoSupervisor']),
    correoCliente: pick(row, ['CorreoCliente', 'Correo_Cliente']),
    tipoDispositivoId: text(pick(row, ['TipoDispositivoID'])),
    tipoDispositivo: pick(row, ['TipoDispositivo']),
    fabricanteId: text(pick(row, ['FabricanteID'])),
    fabricante: pick(row, ['Fabricante']),
    modeloId: text(pick(row, ['ModeloID'])),
    modelo: pick(row, ['Modelo']),
    serie: pick(row, ['Serie']),
    nombreDispositivo: pick(row, ['Descripcion', 'Descripción', 'DescripcionEquipo', 'NombreEquipo']),
    razonVisita: pick(row, ['RazonVisita', 'Razon_visita']),
    pruebasRealizadas: pick(row, ['PruebasRealizadas', 'Pruebas realizadas']),
    resultado: pick(row, ['Resultado']),
    recomendaciones: pick(row, ['Recomendaciones']),
    asignados: (data?.asignados || []).map((item) => text(pick(item, ['UsuarioID', 'value'], item))).filter(Boolean),
    enviarCorreoCliente: toBoolean(pick(row, ['EnviarCorreoCliente'], false)),
    correosCC: pick(row, ['CorreosCC']),
  };
}

function payload(form, boletaUid) {
  return {
    boletaUid,
    BoletaUID: boletaUid,
    ...form,
    Titulo: form.titulo,
    CategoriaID: form.categoriaId,
    Categoria: form.categoria,
    TipoFallaID: form.tipoFallaId,
    TipoFalla: form.tipoFalla,
    Fecha: form.fecha,
    HoraInicio: form.horaInicio,
    HoraFinal: form.horaFinal,
    HorasTotales: Number(form.horasTotales || 0),
    ClienteID: form.clienteId,
    Cliente: form.cliente,
    UbicacionID: form.ubicacionId,
    Ubicacion: form.ubicacion,
    UbicacionEquipoID: form.ubicacionEquipoId,
    UbicacionEquipo: form.ubicacionEquipo,
    SupervisorID: form.supervisorId,
    Supervisor: form.supervisor,
    CorreoSupervisor: form.correoSupervisor,
    CorreoCliente: form.correoCliente,
    TipoDispositivoID: form.tipoDispositivoId,
    TipoDispositivo: form.tipoDispositivo,
    FabricanteID: form.fabricanteId,
    Fabricante: form.fabricante,
    ModeloID: form.modeloId,
    Modelo: form.modelo,
    Serie: form.serie,
    Descripcion: form.nombreDispositivo,
    RazonVisita: form.razonVisita,
    PruebasRealizadas: form.pruebasRealizadas,
    Resultado: form.resultado,
    Recomendaciones: form.recomendaciones,
    AsignadoA: form.asignados,
    EnviarCorreoCliente: form.enviarCorreoCliente,
    CorreosCC: form.correosCC,
    Estado: 'PENDIENTE',
  };
}

export default function TicketQuickEditPage() {
  const { boletaUid, section } = useParams();
  const navigate = useNavigate();
  const { sessionToken, hasPermission } = useAuth();
  const config = SECTIONS[section];
  const allowed = hasPermission('BOLETAS_EDITAR');
  const [form, setForm] = useState(null);
  const [catalogs, setCatalogs] = useState({ clients: [], categories: [], failures: [], devices: [], manufacturers: [], models: [], relations: [], users: [] });
  const [locations, setLocations] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      requestAvailable(MODULE_ROUTES.tickets.get, { boletaUid }, sessionToken),
      Promise.allSettled([
        requestAvailable(MODULE_ROUTES.clients.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.categories.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.failureTypes.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.manufacturers.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.models.list, { page: 1, pageSize: 1500, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.deviceManufacturers.list, { page: 1, pageSize: 1500, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.users.list, { page: 1, pageSize: 1000 }, sessionToken),
      ]),
    ]).then(([ticket, results]) => {
      if (!active) return;
      const keys = ['clients', 'categories', 'failures', 'devices', 'manufacturers', 'models', 'relations', 'users'];
      const next = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next[keys[index]] = normalizeItems(result.value);
      });
      setCatalogs((current) => ({ ...current, ...next }));
      setForm(mapForm(ticket));
    }).catch((loadError) => active && setError(loadError.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [boletaUid, sessionToken]);

  useEffect(() => {
    if (!form?.clienteId) {
      setLocations([]);
      setContacts([]);
      return;
    }
    Promise.allSettled([
      requestAvailable(MODULE_ROUTES.clients.locationsList, { clienteId: form.clienteId, activo: true, pageSize: 1000 }, sessionToken),
      requestAvailable(MODULE_ROUTES.clients.contactsList, { clienteId: form.clienteId, activo: true, esSupervisor: true, pageSize: 1000 }, sessionToken),
    ]).then(([locationResult, contactResult]) => {
      if (locationResult.status === 'fulfilled') setLocations(normalizeItems(locationResult.value));
      if (contactResult.status === 'fulfilled') setContacts(normalizeItems(contactResult.value));
    });
  }, [form?.clienteId, sessionToken]);

  useEffect(() => {
    if (!form?.ubicacionId) {
      setEquipment([]);
      return;
    }
    requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, { ubicacionId: form.ubicacionId, activo: true, pageSize: 1000 }, sessionToken)
      .then((result) => setEquipment(normalizeItems(result)))
      .catch((loadError) => setError(loadError.message));
  }, [form?.ubicacionId, sessionToken]);

  useEffect(() => {
    if (!form) return;
    const total = hours(form.horaInicio, form.horaFinal);
    if (form.horasTotales !== total) setForm((current) => ({ ...current, horasTotales: total }));
  }, [form?.horaInicio, form?.horaFinal]);

  const options = useMemo(() => {
    const relationIds = catalogs.relations
      .filter((item) => sameId(pick(item, ['TipoDispositivoID']), form?.tipoDispositivoId) && toBoolean(pick(item, ['Activo'], true), true))
      .map((item) => text(pick(item, ['FabricanteID'])));
    return {
      clients: optionRows(catalogs.clients, ['ClienteID', 'id'], ['Nombre', 'Clientes', 'RazonSocial']),
      categories: optionRows(catalogs.categories, ['CategoriaID', 'id'], ['Nombre']),
      failures: optionRows(catalogs.failures, ['TipoFallaID', 'id'], ['Nombre']),
      devices: optionRows(catalogs.devices, ['TipoDispositivoID', 'id'], ['Nombre']),
      locations: optionRows(locations, ['UbicacionID', 'id'], ['Nombre']),
      equipment: optionRows(equipment, ['UbicacionEquipoID', 'id'], ['Nombre']),
      supervisors: optionRows(contacts, ['ContactoID', 'id'], ['Nombre']),
      manufacturers: optionRows(relationIds.length ? catalogs.manufacturers.filter((item) => relationIds.includes(text(pick(item, ['FabricanteID'])))) : catalogs.manufacturers, ['FabricanteID', 'id'], ['Nombre']),
      models: optionRows(catalogs.models.filter((item) => (!form?.tipoDispositivoId || sameId(pick(item, ['TipoDispositivoID']), form.tipoDispositivoId)) && (!form?.fabricanteId || sameId(pick(item, ['FabricanteID']), form.fabricanteId))), ['ModeloID', 'id'], ['Nombre']),
      technicians: catalogs.users.map((item) => {
        const label = pick(item, ['NombreCompleto', 'Nombre']);
        const parts = String(label || '').split(/\s+/);
        return { value: text(pick(item, ['UsuarioID', 'id'])), label, note: pick(item, ['Correo', 'NombreUsuario']), initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() };
      }).filter((item) => item.value && item.label),
    };
  }, [catalogs, locations, equipment, contacts, form?.tipoDispositivoId, form?.fabricanteId]);

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function choose(event, optionList, idField, nameField, reset = {}, extra = null) {
    const selected = optionList.find((option) => option.value === event.target.value);
    setForm((current) => ({
      ...current,
      [idField]: event.target.value,
      [nameField]: selected?.label || '',
      ...reset,
      ...(extra ? extra(selected?.row) : {}),
    }));
  }

  function validate() {
    if (section === 'general' && (!form.titulo || !form.categoriaId || !form.tipoFallaId || !form.fecha)) return 'Complete título, categoría, tipo de falla y fecha.';
    if (section === 'client' && !form.clienteId) return 'Seleccione un cliente.';
    if (section === 'device' && (!form.tipoDispositivoId || !form.nombreDispositivo.trim())) return 'Seleccione el tipo y escriba el nombre del dispositivo.';
    if (section === 'work' && !form.asignados.length) return 'Seleccione al menos un técnico.';
    return '';
  }

  async function save(event) {
    event.preventDefault();
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.tickets.update, payload(form, boletaUid), sessionToken);
      navigate(`/boletas/${encodeURIComponent(boletaUid)}`, { replace: true });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) return <Navigate to={`/boletas/${encodeURIComponent(boletaUid)}`} replace />;
  if (!config) return <Navigate to={`/boletas/${encodeURIComponent(boletaUid)}`} replace />;
  if (loading || !form) return <div className="page page--narrow"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando edición rápida...</div></div>;

  return (
    <div className="page page--narrow ticket-quick-edit-page">
      <div className="page-header ticket-form-header">
        <button className="icon-button" type="button" onClick={() => navigate(`/boletas/${encodeURIComponent(boletaUid)}`)} aria-label="Cancelar"><Icon name="close" /></button>
        <div><span className="eyebrow">Edición rápida</span><h1>{config.title}</h1></div>
        <span className="ticket-quick-edit-page__icon"><Icon name={config.icon} /></span>
      </div>

      <section className="ticket-quick-edit-intro">
        <div><Icon name="bolt" /><div><strong>Cambie solo lo necesario</strong><p>{config.description}</p></div></div>
        <button className="button button--ghost button--compact" type="button" onClick={() => navigate(`/boletas/${encodeURIComponent(boletaUid)}/editar`)}><Icon name="edit_note" />Edición completa</button>
      </section>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      <form className="form-card ticket-form-card ticket-quick-edit-form" onSubmit={save}>
        <div className="form-card__heading"><span className="section-marker" /><div><h2>{config.title}</h2><p>{config.description}</p></div></div>
        <div className="stack-form">
          {section === 'general' && <>
            <Field label="Título" name="titulo" value={form.titulo} onChange={update} required />
            <div className="ticket-form-grid">
              <Select label="Categoría" value={form.categoriaId} options={options.categories} required onChange={(event) => choose(event, options.categories, 'categoriaId', 'categoria')} />
              <Select label="Tipo de falla" value={form.tipoFallaId} options={options.failures} required onChange={(event) => choose(event, options.failures, 'tipoFallaId', 'tipoFalla')} />
            </div>
            <div className="ticket-form-grid ticket-form-grid--three">
              <Field label="Fecha" type="date" name="fecha" value={form.fecha} onChange={update} required />
              <Field label="Hora inicio" type="time" name="horaInicio" value={form.horaInicio} onChange={update} />
              <Field label="Hora final" type="time" name="horaFinal" value={form.horaFinal} onChange={update} />
            </div>
            <Field label="Horas totales" type="number" step="0.01" name="horasTotales" value={form.horasTotales} onChange={update} />
          </>}

          {section === 'client' && <>
            <Select label="Cliente" value={form.clienteId} options={options.clients} required onChange={(event) => choose(event, options.clients, 'clienteId', 'cliente', { ubicacionId: '', ubicacion: '', ubicacionEquipoId: '', ubicacionEquipo: '', supervisorId: '', supervisor: '', correoSupervisor: '' }, (row) => ({ correoCliente: pick(row, ['CorreoGeneral', 'Correo']) }))} />
            <div className="ticket-form-grid">
              <Select label="Ubicación" value={form.ubicacionId} options={options.locations} disabled={!form.clienteId} onChange={(event) => choose(event, options.locations, 'ubicacionId', 'ubicacion', { ubicacionEquipoId: '', ubicacionEquipo: '' })} />
              <Select label="Ubicación del equipo" value={form.ubicacionEquipoId} options={options.equipment} disabled={!form.ubicacionId} onChange={(event) => choose(event, options.equipment, 'ubicacionEquipoId', 'ubicacionEquipo')} />
            </div>
            <Select label="Supervisor" value={form.supervisorId} options={options.supervisors} disabled={!form.clienteId} onChange={(event) => choose(event, options.supervisors, 'supervisorId', 'supervisor', {}, (row) => ({ correoSupervisor: pick(row, ['Correo']) }))} />
            <div className="ticket-form-grid">
              <Field label="Correo supervisor" type="email" name="correoSupervisor" value={form.correoSupervisor} onChange={update} />
              <Field label="Correo cliente" type="email" name="correoCliente" value={form.correoCliente} onChange={update} />
            </div>
          </>}

          {section === 'device' && <>
            <Select label="Tipo de dispositivo" value={form.tipoDispositivoId} options={options.devices} required onChange={(event) => choose(event, options.devices, 'tipoDispositivoId', 'tipoDispositivo', { fabricanteId: '', fabricante: '', modeloId: '', modelo: '' })} />
            <Field label="Nombre del dispositivo" name="nombreDispositivo" value={form.nombreDispositivo} onChange={update} required />
            <div className="ticket-form-grid">
              <Select label="Fabricante" value={form.fabricanteId} options={options.manufacturers} disabled={!form.tipoDispositivoId} onChange={(event) => choose(event, options.manufacturers, 'fabricanteId', 'fabricante', { modeloId: '', modelo: '' })} />
              <Select label="Modelo" value={form.modeloId} options={options.models} disabled={!form.fabricanteId} onChange={(event) => choose(event, options.models, 'modeloId', 'modelo')} />
            </div>
            <Field label="Serie" name="serie" value={form.serie} onChange={update} />
          </>}

          {section === 'work' && <>
            <Field label="Razón de visita" multiline name="razonVisita" value={form.razonVisita} onChange={update} />
            <Field label="Pruebas realizadas" multiline name="pruebasRealizadas" value={form.pruebasRealizadas} onChange={update} />
            <Field label="Resultado" multiline name="resultado" value={form.resultado} onChange={update} />
            <Field label="Recomendaciones" multiline name="recomendaciones" value={form.recomendaciones} onChange={update} />
            <TechnicianMultiSelect users={options.technicians} selectedIds={form.asignados} onChange={(asignados) => setForm((current) => ({ ...current, asignados }))} disabled={saving} />
          </>}
        </div>

        <div className="ticket-quick-edit-form__actions">
          <button className="button button--secondary" type="button" onClick={() => navigate(`/boletas/${encodeURIComponent(boletaUid)}`)} disabled={saving}><Icon name="close" />Cancelar</button>
          <button className="button button--primary" type="submit" disabled={saving}><Icon name={saving ? 'progress_activity' : 'save'} />{saving ? 'Guardando...' : 'Guardar cambios'}</button>
        </div>
      </form>
    </div>
  );
}
