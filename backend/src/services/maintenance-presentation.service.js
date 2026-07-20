import { AppError } from '../core/errors.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function active(value) {
  return value !== false && String(value ?? 'true').toLowerCase() !== 'false';
}

function imagePayload(image = {}) {
  return {
    FotoDispositivoID: clean(image.FotoDispositivoID || image.EvidenciaID || image.id),
    Tipo: clean(image.Tipo || image.Estado || image.EstadoFoto || image.TipoFoto),
    Estado: clean(image.Estado || image.Tipo),
    Nota: clean(image.Nota),
    Nombre: clean(image.Nombre || image.NombreArchivo),
    NombreArchivo: clean(image.NombreArchivo || image.Nombre),
    DriveFileID: clean(image.DriveFileID || image.ArchivoID || image.ArchivoFileID),
    DriveURL: clean(image.DriveURL || image.ArchivoURL),
    ArchivoID: clean(image.ArchivoID || image.DriveFileID),
    ArchivoURL: clean(image.ArchivoURL || image.DriveURL),
    MimeType: clean(image.MimeType, 'image/jpeg'),
    Activo: active(image.Activo),
  };
}

function devicePayload(device = {}) {
  return {
    EvidenciaMantenimientoID: clean(device.EvidenciaMantenimientoID || device.DispositivoMantenimientoID || device.id),
    Zona: clean(device.Zona || device.UbicacionEspecifica),
    Categoria: clean(device.Categoria || device.TipoDispositivo),
    TipoDispositivo: clean(device.TipoDispositivo || device.Categoria),
    NombreDispositivo: clean(device.NombreDispositivo || device.Nombre, 'Dispositivo'),
    Fabricante: clean(device.Fabricante),
    Modelo: clean(device.Modelo),
    Serie: clean(device.Serie),
    Funcionamiento: clean(device.Funcionamiento),
    EnUso: clean(device.EnUso),
    Estado: clean(device.Estado),
    Observacion: clean(device.Observacion),
    RespuestasJSON: device.RespuestasJSON || '{}',
    CarpetaDispositivoURL: clean(device.CarpetaDispositivoURL),
    Imagenes: (Array.isArray(device.Imagenes) ? device.Imagenes : [])
      .filter((image) => active(image?.Activo))
      .map(imagePayload),
  };
}

async function postAppsScript(url, payload) {
  const timeoutMs = Math.max(30_000, Number(process.env.APPS_SCRIPT_TIMEOUT_MS || 330_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError(
        'APPS_SCRIPT_INVALID_RESPONSE',
        `Apps Script respondió con un formato inválido (${response.status}).`,
        502,
        { preview: text.slice(0, 300) },
      );
    }

    if (!response.ok || !parsed?.ok) {
      throw new AppError(
        parsed?.error?.code || 'MAINTENANCE_PRESENTATION_FAILED',
        parsed?.error?.message || `Apps Script rechazó la presentación (${response.status}).`,
        502,
      );
    }

    return parsed.data || {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError(
        'MAINTENANCE_PRESENTATION_TIMEOUT',
        'Apps Script tardó demasiado en generar la presentación de mantenimiento.',
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Genera la presentación mediante el mismo Apps Script que crea los reportes.
 * El backend entrega los datos y los IDs privados de Drive; Apps Script inserta
 * los blobs directamente en Slides sin publicar las fotografías en Internet.
 */
export async function generateMaintenancePresentationWithAppsScript({
  maintenance,
  devices,
  baseFolderId,
  actor,
}) {
  const url = clean(process.env.APPS_SCRIPT_REPORT_URL);
  const secret = clean(process.env.APPS_SCRIPT_REPORT_SECRET);
  const maintenanceId = clean(maintenance?.MantenimientoID);

  if (!url) {
    throw new AppError(
      'APPS_SCRIPT_URL_MISSING',
      'Falta configurar APPS_SCRIPT_REPORT_URL en el backend.',
      503,
    );
  }
  if (!secret) {
    throw new AppError(
      'APPS_SCRIPT_SECRET_MISSING',
      'Falta configurar APPS_SCRIPT_REPORT_SECRET en el backend.',
      503,
    );
  }
  if (!maintenanceId) {
    throw new AppError(
      'MAINTENANCE_PRESENTATION_ID_MISSING',
      'No se indicó el mantenimiento para crear la presentación.',
      400,
    );
  }
  if (!Array.isArray(devices) || !devices.length) {
    throw new AppError(
      'MAINTENANCE_PRESENTATION_WITHOUT_DEVICES',
      'Debe registrar al menos un dispositivo antes de crear la presentación.',
      400,
    );
  }

  const result = await postAppsScript(url, {
    action: 'maintenance.presentation.create',
    secret,
    idempotencyKey: `maintenance-presentation:${maintenanceId}:${Date.now()}`,
    baseFolderId: clean(baseFolderId),
    maintenance: {
      ...maintenance,
      MantenimientoID: maintenanceId,
    },
    devices: devices.map(devicePayload),
    actor: actor ? {
      UsuarioID: clean(actor.UsuarioID || actor.id),
      Nombre: clean(actor.NombreCompleto || actor.Nombre || actor.NombreUsuario),
      Correo: clean(actor.Correo || actor.Email || actor.email),
    } : null,
  });

  const slidesId = clean(result.slidesId || result.presentationId || result.id);
  const slidesUrl = clean(
    result.slidesUrl
      || result.presentationUrl
      || result.url,
    slidesId ? `https://docs.google.com/presentation/d/${slidesId}/edit` : '',
  );

  if (!slidesId || !slidesUrl) {
    throw new AppError(
      'MAINTENANCE_PRESENTATION_INVALID_RESULT',
      'Apps Script creó una respuesta incompleta y no devolvió el enlace de la presentación.',
      502,
    );
  }

  return {
    ...result,
    slidesId,
    slidesUrl,
  };
}
