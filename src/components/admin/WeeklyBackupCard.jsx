import React, { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import Icon from '../common/Icon';

const DAYS = [
  ['0', 'Domingo'],
  ['1', 'Lunes'],
  ['2', 'Martes'],
  ['3', 'Miércoles'],
  ['4', 'Jueves'],
  ['5', 'Viernes'],
  ['6', 'Sábado'],
];

function formatDateTime(value) {
  if (!value) return 'Todavía no se ha creado un respaldo';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Costa_Rica',
  }).format(date);
}

function settingsFromResponse(result = {}) {
  return result?.settings || result || {};
}

export default function WeeklyBackupCard() {
  const { sessionToken } = useAuth();
  const [settings, setSettings] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [day, setDay] = useState('0');
  const [hour, setHour] = useState('2');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function apply(next) {
    const value = settingsFromResponse(next);
    setSettings(value);
    setEnabled(Boolean(value.enabled));
    setDay(String(value.day ?? 0));
    setHour(String(value.hour ?? 2));
  }

  async function load() {
    setError('');
    try {
      const result = await requestAvailable(MODULE_ROUTES.config.get, {
        section: 'BACKUPS',
        operation: 'GET',
      }, sessionToken);
      apply(result);
    } catch (loadError) {
      setError(loadError.message || 'No se pudo consultar la configuración de respaldos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sessionToken]);

  async function save() {
    setWorking('save');
    setMessage('');
    setError('');
    try {
      const result = await requestAvailable(MODULE_ROUTES.config.get, {
        section: 'BACKUPS',
        operation: 'UPDATE',
        enabled,
        day: Number(day),
        hour: Number(hour),
      }, sessionToken);
      apply(result);
      setMessage(enabled
        ? 'Respaldo semanal activado y configuración guardada.'
        : 'Respaldo semanal desactivado. Las copias existentes permanecen en Drive.');
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar la configuración de respaldos.');
    } finally {
      setWorking('');
    }
  }

  async function createNow() {
    if (!window.confirm('¿Crear ahora una copia completa de la base de datos de DMS Boletas?')) return;
    setWorking('create');
    setMessage('');
    setError('');
    try {
      const result = await requestAvailable(MODULE_ROUTES.config.get, {
        section: 'BACKUPS',
        operation: 'CREATE',
      }, sessionToken);
      apply(result);
      setMessage(`Respaldo creado correctamente${result?.backup?.fileName ? `: ${result.backup.fileName}` : ''}.`);
    } catch (createError) {
      setError(createError.message || 'No se pudo crear la copia de respaldo.');
    } finally {
      setWorking('');
    }
  }

  return <div className="weekly-backup-card">
    <div className="appearance-selector__heading">
      <span className="menu-row__icon"><Icon name="backup" /></span>
      <div><strong>Copias de respaldo</strong><small>Copia completa semanal del Google Sheets principal en una carpeta de Drive.</small></div>
    </div>

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando configuración...</span></div> : <>
      <div className="offline-mode-selector__copy">
        <strong>Respaldo automático semanal</strong>
        <small>{enabled ? `Programado: ${DAYS.find(([value]) => value === day)?.[1] || 'Domingo'} a las ${String(hour).padStart(2, '0')}:00, hora de Costa Rica.` : 'Desactivado. Puede crear una copia manual cuando lo necesite.'}</small>
      </div>

      <div className="form-grid">
        <label className="field-group field-group--full">
          <span className="field-label">Estado</span>
          <select className="form-control" value={enabled ? 'true' : 'false'} onChange={(event) => setEnabled(event.target.value === 'true')} disabled={Boolean(working)}>
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </label>
        <label className="field-group">
          <span className="field-label">Día</span>
          <select className="form-control" value={day} onChange={(event) => setDay(event.target.value)} disabled={!enabled || Boolean(working)}>
            {DAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field-group">
          <span className="field-label">Hora</span>
          <select className="form-control" value={hour} onChange={(event) => setHour(event.target.value)} disabled={!enabled || Boolean(working)}>
            {Array.from({ length: 24 }, (_, value) => <option key={value} value={String(value)}>{String(value).padStart(2, '0')}:00</option>)}
          </select>
        </label>
      </div>

      <div className="ticket-detail-actions">
        <button type="button" className="button button--secondary" onClick={save} disabled={Boolean(working)}><Icon name="save" />{working === 'save' ? 'Guardando...' : 'Guardar configuración'}</button>
        <button type="button" className="button button--primary" onClick={createNow} disabled={Boolean(working)}><Icon name="backup" />{working === 'create' ? 'Creando respaldo...' : 'Crear respaldo ahora'}</button>
      </div>

      <div className="ticket-info-grid">
        <div><span>Última copia</span><strong>{formatDateTime(settings?.lastAt)}</strong></div>
        <div><span>Estado</span><strong>{settings?.lastStatus || 'SIN_RESPALDO'}</strong></div>
      </div>
      {(settings?.lastUrl || settings?.folderUrl) && <div className="ticket-detail-actions">
        {settings.lastUrl && <a className="button button--ghost" href={settings.lastUrl} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Abrir última copia</a>}
        {settings.folderUrl && <a className="button button--ghost" href={settings.folderUrl} target="_blank" rel="noreferrer"><Icon name="folder_open" />Carpeta de respaldos</a>}
      </div>}
      {settings?.lastError && <div className="alert alert--error"><Icon name="error" /><span>{settings.lastError}</span></div>}
      {message && <div className="alert alert--success"><Icon name="check_circle" /><span>{message}</span></div>}
      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    </>}
  </div>;
}
