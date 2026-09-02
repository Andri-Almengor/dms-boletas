import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import DependentSelect from '../../components/forms/DependentSelect';
import '../../styles/agenda-resend.css';

const CLIENT_PAGE_SIZE = 80;

function clean(value) {
  return String(value ?? '').trim();
}

function clientId(client = {}) {
  return clean(client.ClienteID || client.ID || client.id);
}

function clientName(client = {}) {
  return clean(client.Nombre || client.Clientes || client.Cliente || client.RazonSocial || 'Cliente');
}

function clientRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

function mergeClients(current, incoming) {
  const merged = new Map();
  [...current, ...incoming].forEach((client) => {
    const id = clientId(client);
    if (id) merged.set(id, client);
  });
  return [...merged.values()];
}

export default function AgendaClientAssignment({ item, onSaved }) {
  const { sessionToken } = useAuth();
  const [clients, setClients] = useState([]);
  const [selectedId, setSelectedId] = useState(clean(item?.ClienteID));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const currentId = clean(item?.ClienteID);
  const currentName = clean(item?.ClienteNombre);

  const searchClients = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const response = await apiRequest('clients.list', {
        page: 1,
        pageSize: CLIENT_PAGE_SIZE,
        activo: true,
        q: clean(query),
      }, sessionToken);
      const rows = clientRows(response);
      setClients((current) => mergeClients(current, rows));
      return rows;
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    setSelectedId(currentId);
    setFeedback('');
    setClients([]);
    searchClients('').catch(() => {});
  }, [currentId, item?.AgendaID, searchClients]);

  const options = useMemo(() => clients
    .map((client) => ({ value: clientId(client), label: clientName(client) }))
    .filter((option) => option.value)
    .sort((left, right) => left.label.localeCompare(right.label, 'es', { sensitivity: 'base' })), [clients]);

  const selectedLabel = options.find((option) => option.value === selectedId)?.label
    || (selectedId === currentId ? currentName : '');
  const changed = selectedId !== currentId;

  async function save() {
    if (!item?.AgendaID || saving || !changed) return;
    setSaving(true);
    setFeedback('');
    try {
      const response = await apiRequest('agenda.update', {
        agendaId: item.AgendaID,
        clienteId: selectedId,
        soloCliente: true,
      }, sessionToken);
      setFeedback(response?.message || 'Cliente relacionado actualizado correctamente.');
      await onSaved?.(response);
    } catch (error) {
      setFeedback(error?.message || 'No se pudo actualizar el cliente relacionado.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="agenda-client-panel" aria-label="Asignar cliente a la agenda">
    <div className="agenda-client-panel__heading">
      <span className="eyebrow">Cliente de la visita</span>
      <strong>{currentName || 'Sin cliente relacionado'}</strong>
      <small>Se usa únicamente para reconocer qué boleta corresponde a esta agenda. No cambia la forma de crear boletas.</small>
    </div>

    <div className="agenda-client-panel__controls">
      <DependentSelect
        label="Asignar cliente"
        name="agendaClienteId"
        value={selectedId}
        selectedLabel={selectedLabel}
        options={options}
        searchable
        loading={loading && !options.length}
        searchPlaceholder="Escriba el nombre o una parte del nombre..."
        onSearch={searchClients}
        searchDelay={250}
        onChange={(event) => {
          setSelectedId(clean(event.target.value));
          setFeedback('');
        }}
      />
      <button type="button" className="button button--primary agenda-client-panel__save" onClick={save} disabled={saving || !changed}>
        <Icon name={saving ? 'progress_activity' : 'save'} />
        {saving ? 'Guardando...' : selectedId ? 'Guardar cliente' : 'Quitar cliente'}
      </button>
    </div>

    {feedback && <div className="agenda-client-panel__feedback" role="status"><Icon name="info" /><span>{feedback}</span></div>}
  </section>;
}
