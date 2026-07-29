import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import DependentSelect from '../../components/forms/DependentSelect';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import TechnicianMultiSelect from '../../components/forms/TechnicianMultiSelect';
import TechnicalWritingAssistant from '../../components/tickets/TechnicalWritingAssistant';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const SECTIONS = {
  general: { title: 'Información general', icon: 'description', description: 'Título, categoría, falla, fecha y tiempos.' },
  client: { title: 'Cliente', icon: 'corporate_fare', description: 'Cliente, ubicaciones, supervisor y correos.' },
  device: { title: 'Dispositivo / Equipo', icon: 'devices_other', description: 'Tipo, nombre, fabricante, modelo y serie.' },
  work: { title: 'Trabajo realizado', icon: 'engineering', description: 'Motivo, pruebas, resultado, recomendaciones y técnicos.' },
};

const OPERATIONAL_CLIENT_CREATE_ROUTES = {
  location: [
    'clients.operational.locations.create',
    'clientLocations.operational.create',
    'clientes.ubicaciones.operational.create',
    'ubicacionesCliente.operational.create',
  ],
  equipment: [
    'clients.operational.equipmentLocations.create',
    'equipmentLocations.operational.create',
    'clientes.ubicacionesEquipo.operational.create',
    'ubicacionesEquipo.operational.create',
  ],
  supervisor: [
    'clients.operational.contacts.create',
    'contacts.operational.create',
    'clientes.contactos.operational.create',
    'contactosCliente.operational.create',
  ],
};

const OPERATIONAL_CATALOG_CREATE_ROUTES = {
  category: ['catalog.operational.categories.create'],
  failure: ['catalog.operational.failureTypes.create'],
  device: ['catalog.operational.deviceTypes.create'],
  manufacturer: ['catalog.operational.manufacturers.create'],
  model: ['catalog.operational.models.create'],
  relation: ['catalog.operational.deviceManufacturers.create'],
};

const MODAL_TITLES = {
  category: 'Agregar categoría',
  failure: 'Agregar tipo de falla',
  location: 'Agregar ubicación',
  equipment: 'Agregar ubicación del equipo',
  supervisor: 'Agregar supervisor',
  device: 'Agregar tipo de dispositivo',
  manufacturer: 'Agregar fabricante',
  model: 'Agregar modelo',
};

const MODAL_DESCRIPTIONS = {
  location: 'La ubicación quedará asociada al cliente y disponible en futuras boletas y mantenimientos.',
  equipment: 'La ubicación del equipo quedará asociada a la ubicación seleccionada.',
  supervisor: 'El supervisor quedará asociado al cliente y disponible en futuras boletas.',
  manufacturer: 'El fabricante quedará ligado al tipo de dispositivo seleccionado.',
  model: 'El modelo quedará ligado al tipo de dispositivo y fabricante seleccionados.',
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

function appendUnique(rows, row, idKeys) {
  const id = text(pick(row, idKeys));
  if (!id || rows.some((item) => sameId(pick(item, idKeys), id))) return rows;
  return [...rows, row];
}

function appendRelationUnique(rows, relation) {
  const typeId = text(pick(relation, ['TipoDispositivoID', 'tipoDispositivoId']));
  const manufacturerId = text(pick(relation, ['FabricanteID', 'fabricanteId']));
  if (!typeId || !manufacturerId) return rows;
  const exists = rows.some((item) => (
    sameId(pick(item, ['TipoDispositivoID', 'tipoDispositivoId']), typeId)
    && sameId(pick(item, ['FabricanteID', 'fabricanteId']), manufacturerId)
  ));
  return exists ? rows : [...rows, relation];
}

function includeCurrentSelection(rows, allRows, selectedId, idKeys) {
  if (!selectedId || rows.some((row) => sameId(pick(row, idKeys), selectedId))) return rows;
  const selected = allRows.find((row) => sameId(pick(row, idKeys), selectedId));
  return selected ? [...rows, selected] : rows;
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
  const [modal, setModal] = useState(null);
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

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
    const linkedManufacturerIds = catalogs.relations
      .filter((item) => sameId(pick(item, ['TipoDispositivoID', 'tipoDispositivoId']), form?.tipoDispositivoId)
        && toBoolean(pick(item, ['Activo'], true), true))
      .map((item) => text(pick(item, ['FabricanteID', 'fabricanteId'])))
      .filter(Boolean);

    const strictlyLinkedManufacturers = form?.tipoDispositivoId
      ? catalogs.manufacturers.filter((item) => linkedManufacturerIds.includes(text(pick(item, ['FabricanteID', 'id']))))
      : [];
    const manufacturerRows = includeCurrentSelection(
      strictlyLinkedManufacturers,
      catalogs.manufacturers,
      form?.fabricanteId,
      ['FabricanteID', 'id'],
    );

    const strictlyLinkedModels = form?.tipoDispositivoId && form?.fabricanteId
      ? catalogs.models.filter((item) => (
        sameId(pick(item, ['TipoDispositivoID', 'tipoDispositivoId']), form.tipoDispositivoId)
        && sameId(pick(item, ['FabricanteID', 'fabricanteId']), form.fabricanteId)
      ))
      : [];
    const modelRows = includeCurrentSelection(
      strictlyLinkedModels,
      catalogs.models,
      form?.modeloId,
      ['ModeloID', 'id'],
    );

    return {
      clients: optionRows(catalogs.clients, ['ClienteID', 'id'], ['Nombre', 'Clientes', 'RazonSocial']),
      categories: optionRows(catalogs.categories, ['CategoriaID', 'id'], ['Nombre']),
      failures: optionRows(catalogs.failures, ['TipoFallaID', 'id'], ['Nombre']),
      devices: optionRows(catalogs.devices, ['TipoDispositivoID', 'id'], ['Nombre']),
      locations: optionRows(locations, ['UbicacionID', 'id'], ['Nombre']),
      equipment: optionRows(equipment, ['UbicacionEquipoID', 'id'], ['Nombre']),
      supervisors: optionRows(contacts, ['ContactoID', 'id'], ['Nombre']),
      manufacturers: optionRows(manufacturerRows, ['FabricanteID', 'id'], ['Nombre']),
      models: optionRows(modelRows, ['ModeloID', 'id'], ['Nombre']),
      technicians: catalogs.users.map((item) => {
        const label = pick(item, ['NombreCompleto', 'Nombre']);
        const parts = String(label || '').split(/\s+/);
        return { value: text(pick(item, ['UsuarioID', 'id'])), label, note: pick(item, ['Correo', 'NombreUsuario']), initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() };
      }).filter((item) => item.value && item.label),
    };
  }, [catalogs, locations, equipment, contacts, form?.tipoDispositivoId, form?.fabricanteId, form?.modeloId]);

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

  function openModal(type) {
    setModal({
      type,
      values: {
        nombre: '',
        descripcion: '',
        correo: '',
        puesto: '',
        telefono: '',
        direccion: '',
        notas: '',
        imagenReferenciaURL: '',
      },
    });
    setModalError('');
  }

  function modalUpdate(event) {
    const { name, value } = event.target;
    setModal((current) => ({
      ...current,
      values: { ...current.values, [name]: value },
    }));
  }

  function validateModal(type, values) {
    if (!values.nombre.trim()) return 'El nombre es obligatorio.';
    if (type === 'location' && !form.clienteId) return 'Seleccione primero el cliente.';
    if (type === 'equipment' && !form.ubicacionId) return 'Seleccione primero la ubicación.';
    if (type === 'supervisor' && !form.clienteId) return 'Seleccione primero el cliente.';
    if (type === 'supervisor' && !values.correo.trim()) return 'El correo del supervisor es obligatorio.';
    if (type === 'manufacturer' && !form.tipoDispositivoId) return 'Seleccione primero el tipo de dispositivo.';
    if (type === 'model' && !form.tipoDispositivoId) return 'Seleccione primero el tipo de dispositivo.';
    if (type === 'model' && !form.fabricanteId) return 'Seleccione primero el fabricante.';
    return '';
  }

  async function submitClientModal(type, values) {
    if (type === 'location') {
      const result = await requestAvailable(OPERATIONAL_CLIENT_CREATE_ROUTES.location, {
        clienteId: form.clienteId,
        nombre: values.nombre,
        direccion: values.direccion,
        notas: values.notas,
        activo: true,
      }, sessionToken);
      setLocations((rows) => appendUnique(rows, result, ['UbicacionID', 'id']));
      setEquipment([]);
      setForm((current) => ({
        ...current,
        ubicacionId: text(pick(result, ['UbicacionID', 'id'])),
        ubicacion: pick(result, ['Nombre'], values.nombre),
        ubicacionEquipoId: '',
        ubicacionEquipo: '',
      }));
      return true;
    }

    if (type === 'equipment') {
      const result = await requestAvailable(OPERATIONAL_CLIENT_CREATE_ROUTES.equipment, {
        ubicacionId: form.ubicacionId,
        nombre: values.nombre,
        descripcion: values.descripcion,
        activo: true,
      }, sessionToken);
      setEquipment((rows) => appendUnique(rows, result, ['UbicacionEquipoID', 'id']));
      setForm((current) => ({
        ...current,
        ubicacionEquipoId: text(pick(result, ['UbicacionEquipoID', 'id'])),
        ubicacionEquipo: pick(result, ['Nombre'], values.nombre),
      }));
      return true;
    }

    if (type === 'supervisor') {
      const result = await requestAvailable(OPERATIONAL_CLIENT_CREATE_ROUTES.supervisor, {
        clienteId: form.clienteId,
        nombre: values.nombre,
        correo: values.correo,
        puesto: values.puesto,
        telefono: values.telefono,
        esSupervisor: true,
        recibeCorreo: true,
        activo: true,
      }, sessionToken);
      setContacts((rows) => appendUnique(rows, result, ['ContactoID', 'id']));
      setForm((current) => ({
        ...current,
        supervisorId: text(pick(result, ['ContactoID', 'id'])),
        supervisor: pick(result, ['Nombre'], values.nombre),
        correoSupervisor: pick(result, ['Correo'], values.correo),
      }));
      return true;
    }

    return false;
  }

  async function submitCatalogModal(type, values) {
    if (type === 'category') {
      const result = await requestAvailable(OPERATIONAL_CATALOG_CREATE_ROUTES.category, {
        nombre: values.nombre,
        descripcion: values.descripcion,
        activo: true,
      }, sessionToken);
      setCatalogs((current) => ({ ...current, categories: appendUnique(current.categories, result, ['CategoriaID', 'id']) }));
      setForm((current) => ({ ...current, categoriaId: text(pick(result, ['CategoriaID', 'id'])), categoria: pick(result, ['Nombre'], values.nombre) }));
      return true;
    }

    if (type === 'failure') {
      const result = await requestAvailable(OPERATIONAL_CATALOG_CREATE_ROUTES.failure, {
        nombre: values.nombre,
        descripcion: values.descripcion,
        activo: true,
      }, sessionToken);
      setCatalogs((current) => ({ ...current, failures: appendUnique(current.failures, result, ['TipoFallaID', 'id']) }));
      setForm((current) => ({ ...current, tipoFallaId: text(pick(result, ['TipoFallaID', 'id'])), tipoFalla: pick(result, ['Nombre'], values.nombre) }));
      return true;
    }

    if (type === 'device') {
      const result = await requestAvailable(OPERATIONAL_CATALOG_CREATE_ROUTES.device, {
        nombre: values.nombre,
        descripcion: values.descripcion,
        activo: true,
      }, sessionToken);
      setCatalogs((current) => ({ ...current, devices: appendUnique(current.devices, result, ['TipoDispositivoID', 'id']) }));
      setForm((current) => ({
        ...current,
        tipoDispositivoId: text(pick(result, ['TipoDispositivoID', 'id'])),
        tipoDispositivo: pick(result, ['Nombre'], values.nombre),
        fabricanteId: '',
        fabricante: '',
        modeloId: '',
        modelo: '',
      }));
      return true;
    }

    if (type === 'manufacturer') {
      const result = await requestAvailable(OPERATIONAL_CATALOG_CREATE_ROUTES.manufacturer, {
        nombre: values.nombre,
        activo: true,
      }, sessionToken);
      const manufacturerId = text(pick(result, ['FabricanteID', 'id']));
      if (!manufacturerId) throw new Error('El servidor no devolvió el identificador del fabricante.');
      const relationResult = await requestAvailable(OPERATIONAL_CATALOG_CREATE_ROUTES.relation, {
        tipoDispositivoId: form.tipoDispositivoId,
        fabricanteId: manufacturerId,
        activo: true,
      }, sessionToken);
      const relation = {
        ...relationResult,
        TipoDispositivoID: pick(relationResult, ['TipoDispositivoID'], form.tipoDispositivoId),
        FabricanteID: pick(relationResult, ['FabricanteID'], manufacturerId),
        Activo: pick(relationResult, ['Activo'], true),
      };
      setCatalogs((current) => ({
        ...current,
        manufacturers: appendUnique(current.manufacturers, result, ['FabricanteID', 'id']),
        relations: appendRelationUnique(current.relations, relation),
      }));
      setForm((current) => ({
        ...current,
        fabricanteId: manufacturerId,
        fabricante: pick(result, ['Nombre'], values.nombre),
        modeloId: '',
        modelo: '',
      }));
      return true;
    }

    if (type === 'model') {
      const result = await requestAvailable(OPERATIONAL_CATALOG_CREATE_ROUTES.model, {
        tipoDispositivoId: form.tipoDispositivoId,
        fabricanteId: form.fabricanteId,
        nombre: values.nombre,
        descripcion: values.descripcion,
        imagenReferenciaURL: values.imagenReferenciaURL,
        activo: true,
      }, sessionToken);
      setCatalogs((current) => ({ ...current, models: appendUnique(current.models, result, ['ModeloID', 'id']) }));
      setForm((current) => ({ ...current, modeloId: text(pick(result, ['ModeloID', 'id'])), modelo: pick(result, ['Nombre'], values.nombre) }));
      return true;
    }

    return false;
  }

  async function submitModal(event) {
    event.preventDefault();
    if (!modal) return;
    const { type, values } = modal;
    const validation = validateModal(type, values);
    if (validation) {
      setModalError(validation);
      return;
    }

    setModalSaving(true);
    setModalError('');
    try {
      const handled = await submitClientModal(type, values) || await submitCatalogModal(type, values);
      if (!handled) throw new Error('No fue posible identificar el tipo de registro solicitado.');
      setModal(null);
    } catch (modalSaveError) {
      setModalError(modalSaveError.message);
    } finally {
      setModalSaving(false);
    }
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
              <DependentSelect
                label="Categoría"
                name="categoriaId"
                value={form.categoriaId}
                options={options.categories}
                required
                canAdd={allowed}
                onAdd={() => openModal('category')}
                onChange={(event) => choose(event, options.categories, 'categoriaId', 'categoria')}
              />
              <DependentSelect
                label="Tipo de falla"
                name="tipoFallaId"
                value={form.tipoFallaId}
                options={options.failures}
                required
                canAdd={allowed}
                onAdd={() => openModal('failure')}
                onChange={(event) => choose(event, options.failures, 'tipoFallaId', 'tipoFalla')}
              />
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
              <DependentSelect
                label="Ubicación"
                name="ubicacionId"
                value={form.ubicacionId}
                options={options.locations}
                disabled={!form.clienteId}
                canAdd={allowed && Boolean(form.clienteId)}
                onAdd={() => openModal('location')}
                onChange={(event) => choose(event, options.locations, 'ubicacionId', 'ubicacion', { ubicacionEquipoId: '', ubicacionEquipo: '' })}
              />
              <DependentSelect
                label="Ubicación del equipo"
                name="ubicacionEquipoId"
                value={form.ubicacionEquipoId}
                options={options.equipment}
                disabled={!form.ubicacionId}
                canAdd={allowed && Boolean(form.ubicacionId)}
                onAdd={() => openModal('equipment')}
                onChange={(event) => choose(event, options.equipment, 'ubicacionEquipoId', 'ubicacionEquipo')}
              />
            </div>
            <DependentSelect
              label="Supervisor"
              name="supervisorId"
              value={form.supervisorId}
              options={options.supervisors}
              disabled={!form.clienteId}
              canAdd={allowed && Boolean(form.clienteId)}
              onAdd={() => openModal('supervisor')}
              onChange={(event) => choose(event, options.supervisors, 'supervisorId', 'supervisor', {}, (row) => ({ correoSupervisor: pick(row, ['Correo']) }))}
            />
            <div className="ticket-form-grid">
              <Field label="Correo supervisor" type="email" name="correoSupervisor" value={form.correoSupervisor} onChange={update} />
              <Field label="Correo cliente" type="email" name="correoCliente" value={form.correoCliente} onChange={update} />
            </div>
          </>}

          {section === 'device' && <>
            <DependentSelect
              label="Tipo de dispositivo"
              name="tipoDispositivoId"
              value={form.tipoDispositivoId}
              options={options.devices}
              required
              canAdd={allowed}
              onAdd={() => openModal('device')}
              onChange={(event) => choose(event, options.devices, 'tipoDispositivoId', 'tipoDispositivo', { fabricanteId: '', fabricante: '', modeloId: '', modelo: '' })}
            />
            <Field label="Nombre del dispositivo" name="nombreDispositivo" value={form.nombreDispositivo} onChange={update} required />
            <div className="ticket-form-grid">
              <DependentSelect
                label="Fabricante"
                name="fabricanteId"
                value={form.fabricanteId}
                options={options.manufacturers}
                disabled={!form.tipoDispositivoId}
                canAdd={allowed && Boolean(form.tipoDispositivoId)}
                onAdd={() => openModal('manufacturer')}
                onChange={(event) => choose(event, options.manufacturers, 'fabricanteId', 'fabricante', { modeloId: '', modelo: '' })}
              />
              <DependentSelect
                label="Modelo"
                name="modeloId"
                value={form.modeloId}
                options={options.models}
                disabled={!form.tipoDispositivoId || !form.fabricanteId}
                canAdd={allowed && Boolean(form.tipoDispositivoId) && Boolean(form.fabricanteId)}
                onAdd={() => openModal('model')}
                onChange={(event) => choose(event, options.models, 'modeloId', 'modelo')}
              />
            </div>
            <Field label="Serie" name="serie" value={form.serie} onChange={update} />
          </>}

          {section === 'work' && <>
            <TechnicalWritingAssistant form={form} setForm={setForm} disabled={saving} />
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

      <InlineCreateModal
        open={Boolean(modal)}
        title={MODAL_TITLES[modal?.type] || 'Agregar registro'}
        description={MODAL_DESCRIPTIONS[modal?.type] || 'El nuevo valor quedará disponible para futuras boletas y mantenimientos.'}
        saving={modalSaving}
        error={modalError}
        onClose={() => setModal(null)}
        onSubmit={submitModal}
      >
        {modal && <>
          <Field label="Nombre" name="nombre" value={modal.values.nombre} onChange={modalUpdate} required />
          {modal.type === 'supervisor' && <>
            <Field label="Correo" type="email" name="correo" value={modal.values.correo} onChange={modalUpdate} required />
            <div className="ticket-form-grid">
              <Field label="Puesto" name="puesto" value={modal.values.puesto} onChange={modalUpdate} />
              <Field label="Teléfono" name="telefono" value={modal.values.telefono} onChange={modalUpdate} />
            </div>
          </>}
          {modal.type === 'location' && <>
            <Field label="Dirección" name="direccion" value={modal.values.direccion} onChange={modalUpdate} />
            <Field label="Notas" multiline name="notas" value={modal.values.notas} onChange={modalUpdate} />
          </>}
          {['equipment', 'category', 'failure', 'device', 'model'].includes(modal.type) && <Field label="Descripción" multiline name="descripcion" value={modal.values.descripcion} onChange={modalUpdate} />}
          {modal.type === 'model' && <Field label="Imagen de referencia (URL)" name="imagenReferenciaURL" value={modal.values.imagenReferenciaURL} onChange={modalUpdate} />}
        </>}
      </InlineCreateModal>
    </div>
  );
}
