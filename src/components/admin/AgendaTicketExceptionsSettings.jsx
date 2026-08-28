import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api';
import Icon from '../common/Icon';

const FALLBACK_EXCEPTIONS = Object.freeze([
  'Oficina',
  'Oficinas',
  'Office',
  'RN',
  'Zona Franca La Lima',
]);

function toText(value) {
  return Array.isArray(value) ? value.join('\n') : String(value || '').trim();
}

function splitEntries(value) {
  return String(value || '')
    .split(/[;\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function AgendaTicketExceptionsSettings({ sessionToken, onNotice, onError }) {
  const [value, setValue] = useState(() => FALLBACK_EXCEPTIONS.join('\n'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const entries = useMemo(() => splitEntries(value), [value]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest('config.get', {
        section: 'AGENDA_TICKET_EXCEPTIONS',
      }, sessionToken);
      const configured = response?.settings?.exceptions;
      setValue(toText(Array.isArray(configured) && configured.length ? configured : FALLBACK_EXCEPTIONS));
    } catch (error) {
      onError?.(error?.message || 'No se pudieron cargar las excepciones de boleta de Agenda.');
    } finally {
      setLoading(false);
    }
  }, [onError, sessionToken]);

  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    if (!entries.length) {
      onError?.('Configure al menos una palabra o frase de excepción para la Agenda.');
      return;
    }

    setSaving(true);
    try {
      const response = await apiRequest('config.get', {
        section: 'AGENDA_TICKET_EXCEPTIONS',
        operation: 'UPDATE',
        settings: { exceptions: entries },
      }, sessionToken);
      setValue(toText(response?.settings?.exceptions || entries));
      onNotice?.('Excepciones de boleta de Agenda actualizadas correctamente.');
    } catch (error) {
      onError?.(error?.message || 'No se pudieron guardar las excepciones de Agenda.');
    } finally {
      setSaving(false);
    }
  }

  return <form className="notification-panel notification-panel--email" onSubmit={save}>
    <header className="notification-panel__header">
      <div className="notification-panel__title">
        <span className="notification-panel__icon"><Icon name="playlist_remove" /></span>
        <div>
          <span className="eyebrow">Agenda DMS</span>
          <h2>Excepciones de boleta</h2>
          <p>Las agendas cuyo detalle contenga una de estas palabras o frases no requerirán boleta ni recibirán el recordatorio de boleta faltante.</p>
        </div>
      </div>
      <span className="notification-status-pill is-active"><span />{entries.length} activa{entries.length === 1 ? '' : 's'}</span>
    </header>

    <label className="notification-field-card">
      <span className="notification-field-card__heading">
        <span><Icon name="rule" /></span>
        <span>
          <strong>Palabras y frases de excepción</strong>
          <small>Escriba una por línea. No distingue entre mayúsculas, minúsculas ni acentos y puede usar frases completas, por ejemplo “Zona Franca La Lima”.</small>
        </span>
      </span>
      <textarea
        rows="9"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={'Oficina\nRN\nZona Franca La Lima'}
        disabled={loading || saving}
        spellCheck="false"
      />
      <span className="notification-field-card__count">{loading ? 'Cargando...' : `${entries.length} excepción${entries.length === 1 ? '' : 'es'}`}</span>
    </label>

    <div className="notification-behavior-note">
      <Icon name="info" />
      <div>
        <strong>Cómo funciona</strong>
        <p>Si configura “Zona Franca La Lima”, también se excluirán detalles como “Visita Zona Franca La Lima” o “Zona Franca La Lima · revisión”. Las demás agendas seguirán exigiendo boleta normalmente.</p>
      </div>
    </div>

    <footer className="notification-panel__actions">
      <span><Icon name="mail_off" /> Estas reglas también evitan el correo automático de boleta faltante.</span>
      <button type="submit" className="button button--primary" disabled={loading || saving || !entries.length}>
        <Icon name={saving ? 'progress_activity' : 'save'} /> {saving ? 'Guardando excepciones...' : 'Guardar excepciones'}
      </button>
    </footer>
  </form>;
}
