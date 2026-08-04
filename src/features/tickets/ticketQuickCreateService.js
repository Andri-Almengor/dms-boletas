import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

export const EMPTY_TICKET_INLINE_VALUES = Object.freeze({
  nombre: '',
  descripcion: '',
  correo: '',
  puesto: '',
  telefono: '',
  direccion: '',
  notas: '',
  imagenReferenciaURL: '',
});

function routeList(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

// Regla permanente: los formularios operativos deben intentar primero las rutas
// creadas específicamente para técnicos. Las rutas administrativas permanecen
// únicamente como respaldo para instalaciones antiguas y administradores.
export const TICKET_INLINE_CREATE_ROUTES = Object.freeze({
  location: Object.freeze(routeList([
    'clients.operational.locations.create',
    'clientLocations.operational.create',
    'clientes.ubicaciones.operational.create',
    'ubicacionesCliente.operational.create',
  ], MODULE_ROUTES.clients.locationsCreate)),
  equipment: Object.freeze(routeList([
    'clients.operational.equipmentLocations.create',
    'equipmentLocations.operational.create',
    'clientes.ubicacionesEquipo.operational.create',
    'ubicacionesEquipo.operational.create',
  ], MODULE_ROUTES.clients.equipmentLocationsCreate)),
  supervisor: Object.freeze(routeList([
    'clients.operational.contacts.create',
    'contacts.operational.create',
    'clientes.contactos.operational.create',
    'contactosCliente.operational.create',
  ], MODULE_ROUTES.clients.contactsCreate)),
  category: Object.freeze(routeList([
    'catalog.operational.categories.create',
  ], MODULE_ROUTES.categories.create)),
  failure: Object.freeze(routeList([
    'catalog.operational.failureTypes.create',
  ], MODULE_ROUTES.failureTypes.create)),
  device: Object.freeze(routeList([
    'catalog.operational.deviceTypes.create',
  ], MODULE_ROUTES.deviceTypes.create)),
  manufacturer: Object.freeze(routeList([
    'catalog.operational.manufacturers.create',
  ], MODULE_ROUTES.manufacturers.create)),
  model: Object.freeze(routeList([
    'catalog.operational.models.create',
  ], MODULE_ROUTES.models.create)),
  deviceManufacturer: Object.freeze(routeList([
    'catalog.operational.deviceManufacturers.create',
  ], MODULE_ROUTES.deviceManufacturers.create)),
});

export async function createTicketInlineRecord({
  type,
  values,
  form,
  sessionToken,
  signal,
}) {
  const options = signal ? { signal } : {};
  let result;

  if (type === 'location') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.location, {
      clienteId: form.clienteId,
      nombre: values.nombre,
      direccion: values.direccion,
      notas: values.notas,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'equipment') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.equipment, {
      ubicacionId: form.ubicacionId,
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'supervisor') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.supervisor, {
      clienteId: form.clienteId,
      nombre: values.nombre,
      correo: values.correo,
      puesto: values.puesto,
      telefono: values.telefono,
      esSupervisor: true,
      recibeCorreo: true,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'category') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.category, {
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'failure') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.failure, {
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'device') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.device, {
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'manufacturer') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.manufacturer, {
      nombre: values.nombre,
      activo: true,
    }, sessionToken, options);
    await requestAvailable(TICKET_INLINE_CREATE_ROUTES.deviceManufacturer, {
      tipoDispositivoId: form.tipoDispositivoId,
      fabricanteId: pick(result, ['FabricanteID', 'id']),
      activo: true,
    }, sessionToken, options);
  } else if (type === 'model') {
    result = await requestAvailable(TICKET_INLINE_CREATE_ROUTES.model, {
      tipoDispositivoId: form.tipoDispositivoId,
      fabricanteId: form.fabricanteId,
      nombre: values.nombre,
      descripcion: values.descripcion,
      imagenReferenciaURL: values.imagenReferenciaURL,
      activo: true,
    }, sessionToken, options);
  } else {
    throw new Error('Tipo de registro rápido no soportado.');
  }

  return result;
}

export function ticketInlineSelection(type, result, values = {}) {
  if (type === 'location') {
    return {
      relation: 'location',
      patch: {
        ubicacionId: String(pick(result, ['UbicacionID', 'id'])),
        ubicacion: pick(result, ['Nombre']),
      },
    };
  }
  if (type === 'equipment') {
    return {
      relation: 'equipment',
      patch: {
        ubicacionEquipoId: String(pick(result, ['UbicacionEquipoID', 'id'])),
        ubicacionEquipo: pick(result, ['Nombre']),
      },
    };
  }
  if (type === 'supervisor') {
    return {
      relation: 'supervisor',
      patch: {
        supervisorId: String(pick(result, ['ContactoID', 'id'])),
        supervisor: pick(result, ['Nombre']),
        correoSupervisor: pick(result, ['Correo'], values.correo),
      },
    };
  }

  const keyMap = {
    category: ['categoriaId', 'categoria', 'CategoriaID'],
    failure: ['tipoFallaId', 'tipoFalla', 'TipoFallaID'],
    device: ['tipoDispositivoId', 'tipoDispositivo', 'TipoDispositivoID'],
    manufacturer: ['fabricanteId', 'fabricante', 'FabricanteID'],
    model: ['modeloId', 'modelo', 'ModeloID'],
  };
  const keys = keyMap[type];
  if (!keys) throw new Error('Tipo de selección rápida no soportado.');
  const [idField, nameField, idKey] = keys;
  return {
    relation: '',
    patch: {
      [idField]: String(pick(result, [idKey, 'id'])),
      [nameField]: pick(result, ['Nombre']),
    },
  };
}
