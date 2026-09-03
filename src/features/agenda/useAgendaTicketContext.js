import { useEffect, useState } from 'react';
import { apiRequest } from '../../api';

function clean(value) {
  return String(value ?? '').trim();
}

function assignedIds(agenda = {}) {
  return (agenda.asignados || [])
    .map((user) => clean(user?.UsuarioID || user?.id))
    .filter(Boolean);
}

/**
 * Carga el contexto de una agenda dentro del formulario reutilizable de boletas.
 * No crea una segunda versión del formulario: únicamente prepara sus valores de
 * origen y conserva AgendaID en el payload para que el backend pueda vincular la
 * boleta creada con la agenda correspondiente.
 */
export default function useAgendaTicketContext({
  agendaId,
  sessionToken,
  setForm,
  onError,
}) {
  const normalizedAgendaId = clean(agendaId);
  const [agenda, setAgenda] = useState(null);
  const [loading, setLoading] = useState(Boolean(normalizedAgendaId));

  useEffect(() => {
    if (!normalizedAgendaId) {
      setAgenda(null);
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);

    apiRequest('agenda.get', { agendaId: normalizedAgendaId }, sessionToken)
      .then((response) => {
        if (!active) return;
        const item = response?.item || response?.agenda || response;
        if (!item?.AgendaID) throw new Error('No se pudo cargar la agenda seleccionada.');

        setAgenda(item);
        const technicians = assignedIds(item);
        setForm((current) => ({
          ...current,
          agendaId: clean(item.AgendaID),
          AgendaID: clean(item.AgendaID),
          fecha: clean(item.Fecha) || current.fecha,
          horaInicio: clean(item.HoraInicio) || current.horaInicio,
          horaFinal: clean(item.HoraFin) || current.horaFinal,
          clienteId: clean(item.ClienteID) || current.clienteId,
          cliente: clean(item.ClienteNombre) || current.cliente,
          razonVisita: current.razonVisita || clean(item.Detalle),
          asignados: technicians.length ? technicians : current.asignados,
        }));
      })
      .catch((error) => {
        if (!active) return;
        onError?.(error?.message || 'No se pudo cargar la agenda seleccionada.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [normalizedAgendaId, onError, sessionToken, setForm]);

  return { agenda, loading };
}
