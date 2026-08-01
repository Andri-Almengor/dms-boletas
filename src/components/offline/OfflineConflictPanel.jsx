import React from 'react';
import Icon from '../common/Icon';
import './OfflineConflictPanel.css';

const FIELD_LABELS = Object.freeze({
  '*': 'El registro completo',
  TituloMantenimiento: 'Título',
  ClienteID: 'Cliente',
  Cliente: 'Nombre del cliente',
  UbicacionID: 'Ubicación',
  Ubicacion: 'Nombre de ubicación',
  Estado: 'Estado',
  Fecha: 'Fecha',
  FechaFinalizacion: 'Fecha de finalización',
  ResponsableIDsJSON: 'Responsables',
  DescripcionGeneral: 'Descripción',
  CantidadesJSON: 'Cantidades esperadas',
  UbicacionesEquipoJSON: 'Ubicaciones del mantenimiento',
  UbicacionEquipoID: 'Ubicación del equipo',
  UbicacionEquipoNombre: 'Nombre de ubicación del equipo',
  Zona: 'Zona',
  Categoria: 'Tipo de dispositivo',
  NombreDispositivo: 'Nombre del dispositivo',
  TipoDispositivoID: 'Tipo de dispositivo',
  FabricanteID: 'Fabricante',
  Fabricante: 'Nombre del fabricante',
  ModeloID: 'Modelo',
  Modelo: 'Nombre del modelo',
  Serie: 'Serie',
  Funcionamiento: 'Funcionamiento',
  EnUso: 'En uso',
  Observacion: 'Observación',
  RespuestasJSON: 'Lista de revisión',
  FechaTrabajo: 'Fecha de trabajo',
  TecnicoIDsJSON: 'Técnicos',
  Tipo: 'Tipo de evidencia',
  Nota: 'Nota de evidencia',
});

function conflictTitle(operation = {}) {
  const type = String(operation?.conflict?.entityType || 'registro');
  if (type === 'maintenance') return 'Conflicto en el mantenimiento';
  if (type === 'maintenanceDevice') return 'Conflicto en un dispositivo';
  if (type === 'maintenanceImage') return 'Conflicto en una evidencia';
  if (type === 'maintenanceLocations') return 'Conflicto en las ubicaciones';
  return 'Cambio que requiere revisión';
}

export default function OfflineConflictPanel({ operation, busy, onUseServer, onKeepLocal }) {
  if (!operation) return null;
  const details = operation.conflict || {};
  const fields = Array.isArray(details.conflictFields) && details.conflictFields.length
    ? details.conflictFields
    : ['*'];

  return (
    <section className="offline-conflict" role="alert" aria-live="assertive">
      <div className="offline-conflict__heading">
        <span className="offline-conflict__icon"><Icon name="difference" /></span>
        <div>
          <strong>{conflictTitle(operation)}</strong>
          <p>Otro técnico cambió los mismos datos antes de que este dispositivo recuperara conexión.</p>
        </div>
      </div>

      <div className="offline-conflict__fields">
        <span>Campos en conflicto:</span>
        <ul>
          {fields.map((field) => <li key={field}>{FIELD_LABELS[field] || field}</li>)}
        </ul>
      </div>

      <p className="offline-conflict__hint">
        Los campos que no chocan ya se combinaron automáticamente. Elija qué versión conservar para los campos indicados.
      </p>

      <div className="offline-conflict__actions">
        <button type="button" className="offline-conflict__server" disabled={busy} onClick={() => onUseServer(operation)}>
          Usar versión del servidor
        </button>
        <button type="button" className="offline-conflict__local" disabled={busy} onClick={() => onKeepLocal(operation)}>
          Mantener mis cambios
        </button>
      </div>
    </section>
  );
}
