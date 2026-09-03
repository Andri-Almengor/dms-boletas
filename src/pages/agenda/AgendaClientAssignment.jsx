import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import '../../styles/agenda-resend.css';

function clean(value) {
  return String(value ?? '').trim();
}

function personName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo || 'Usuario');
}

/**
 * Conserva el punto de extensión que antes se utilizaba para seleccionar el
 * cliente de una agenda. El cliente ahora se selecciona dentro del formulario
 * real de la boleta y el backend vincula esa boleta con la agenda al guardarla.
 *
 * Se mantiene este componente/archivo para no duplicar estructura dentro de
 * AgendaPage y para que el cambio sea compatible con el layout existente.
 */
export default function AgendaClientAssignment({ item }) {
  if (!item?.AgendaID) return null;
  if (!item.RequiereBoleta || String(item.Estado || '').toUpperCase() === 'CANCELADA') return null;
  if (item.boleta?.BoletaUID) return null;

  const assignedNames = (item.asignados || []).map(personName).filter(Boolean);
  const target = `/boletas/nueva?agendaId=${encodeURIComponent(item.AgendaID)}`;

  return <section className="agenda-client-panel" aria-label="Crear boleta para esta agenda">
    <div className="agenda-client-panel__heading">
      <span className="eyebrow">Boleta de la agenda</span>
      <strong>Crear la boleta para esta visita</strong>
      <small>
        Se abrirá el mismo formulario completo de creación de boletas. La fecha, el horario y las personas asignadas
        a esta agenda se cargarán automáticamente; el cliente y el resto de la información se completan dentro de la boleta.
      </small>
    </div>

    <div className="agenda-client-panel__feedback">
      <Icon name="groups" />
      <span>
        Técnicos que quedarán asignados: {assignedNames.length ? assignedNames.join(', ') : 'sin personas asignadas'}.
      </span>
    </div>

    <div className="agenda-client-panel__controls">
      <span />
      <Link className="button button--primary agenda-client-panel__save" to={target}>
        <Icon name="add_task" />
        Crear boleta
      </Link>
    </div>
  </section>;
}
