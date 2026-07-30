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
    result = await requestAvailable(MODULE_ROUTES.clients.locationsCreate, {
      clienteId: form.clienteId,
      nombre: values.nombre,
      direccion: values.direccion,
      notas: values.notas,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'equipment') {
    result = await requestAvailable(MODULE_ROUTES.clients.equipmentLocationsCreate, {
      ubicacionId: form.ubicacionId,
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'supervisor') {
    result = await requestAvailable(MODULE_ROUTES.clients.contactsCreate, {
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
    result = await requestAvailable(MODULE_ROUTES.categories.create, {
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'failure') {
    result = await requestAvailable(MODULE_ROUTES.failureTypes.create, {
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'device') {
    result = await requestAvailable(MODULE_ROUTES.deviceTypes.create, {
      nombre: values.nombre,
      descripcion: values.descripcion,
      activo: true,
    }, sessionToken, options);
  } else if (type === 'manufacturer') {
    result = await requestAvailable(MODULE_ROUTES.manufacturers.create, {
      nombre: values.nombre,
      activo: true,
    }, sessionToken, options);
    await requestAvailable(MODULE_ROUTES.deviceManufacturers.create, {
      tipoDispositivoId: form.tipoDispositivoId,
      fabricanteId: pick(result, ['FabricanteID', 'id']),
      activo: true,
    }, sessionToken, options);
  } else if (type === 'model') {
    result = await requestAvailable(MODULE_ROUTES.models.create, {
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
