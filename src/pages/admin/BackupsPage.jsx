import React, { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

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
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Costa_Rica',
  }).format(date);
}

export default function BackupsPage() {
  const { sessionToken } = useAuth();
  const [status, setStatus] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [day, setDay] = useState('0');
  const [hour, setHour] = useState('2');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function applyStatus(next) {
    setStatus(next);
    setEnabled(Boolean(next?.enabled));
    setDay(String(next?.day ?? 0));
    setHour(String(next?.hour ?? 2));
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      applyStatus(await requestAvailable(MODULE_ROUTES.backups.status, {}, sessionToken));
    } catch (loadError) {
      setError(loadError.message || 'No se pudo consultar la configuración de respaldos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sessionToken]);

  async function saveSettings(event) {
    event.preventDefault();
    setWorking('save');
    setError('');
    setNotice('');
    try {
      const result = await requestAvailable(MODULE_ROUTES.backups.update, {
        enabled,
        day: Number(day),
        hour: Number(hour),
      }, sessionToken);
      applyStatus(result);
      setNotice(enabled
        ? 'Respaldo semanal activado y configuración guardada.'
        : 'Respaldo semanal desactivado. Los respaldos existentes permanecen en Drive.');
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar la configuración.');
    } finally {
      setWorking('');
    }
  }

  async function createNow() {
    if (!window.confirm('¿Crear una copia de respaldo completa de la base de datos ahora?')) return;
    setWorking('create');
    setError('');
    setNotice('');
    try {
      const result = await requestAvailable(MODULE_ROUTES.backups.create, {}, sessionToken);
      setNotice(`Respaldo creado correctamente: ${result.fileName || 'copia de seguridad'}.`);
      await load();
    } catch (createError) {
      setError(createError.message || 'No se pudo crear el respaldo.');
    } finally {
      setWorking('');
    }
  }

  if (loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando respaldos...</span></div></div>;

  return <div className="page page--narrow backups-page">
    <div className="page-header">
      <div><span className="eyebrow">Administración</span><h1>Copias de respaldo</h1><p>Proteja la base principal creando copias completas del Google Sheets de DMS Boletas.</p></div>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}

    <section className="section-block">
      <div className="section-heading"><div><span className="eyebrow">Automático</span><h2>Respaldo semanal</h2></div><span className={`status-chip ${enabled ? 'status-chip--active' : 'status-chip--pending'}`}>{enabled ? 'ACTIVO' : 'INACTIVO'}</span></div>
      <p>La copia incluye todas las hojas del archivo principal: boletas, mantenimientos, usuarios, permisos, clientes, catálogos, auditoría, configuraciones e integraciones almacenadas en la base.</p>

      <form className="form-grid" onSubmit={saveSettings}>
        <label className="field-group field-group--full">
          <span className="field-label">Crear copia automáticamente cada semana</span>
          <button type="button" className={`offline-mode-switch${enabled ? ' is-enabled' : ''}`} role="switch" aria-checked={enabled} onClick={() => setEnabled((current) => !current)}>
            <span />
            <b>{enabled ? 'Activo' : 'Inactivo'}</b>
          </button>
        </label>

        <label className="field-group">
          <span className="field-label">Día</span>
          <select className="form-control" value={day} onChange={(event) => setDay(event.target.value)} disabled={!enabled || Boolean(working)}>
            {DAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label className="field-group">
          <span className="field-label">Hora de Costa Rica</span>
          <select className="form-control" value={hour} onChange={(event) => setHour(event.target.value)} disabled={!enabled || Boolean(working)}>
            {Array.from({ length: 24 }, (_, value) => <option key={value} value={String(value)}>{String(value).padStart(2, '0')}:00</option>)}
          </select>
        </label>

        <div className="field-group field-group--full">
          <button className="button button--primary" type="submit" disabled={Boolean(working)}><Icon name="save" />{working === 'save' ? 'Guardando...' : 'Guardar configuración'}</button>
        </div>
      </form>
    </section>

    <section className="section-block">
      <div className="section-heading"><div><span className="eyebrow">Estado</span><h2>Último respaldo</h2></div></div>
      <dl className="ticket-info-grid">
        <div><dt>Fecha</dt><dd>{formatDateTime(status?.lastAt)}</dd></div>
        <div><dt>Estado</dt><dd>{status?.lastStatus || 'SIN_RESPALDO'}</dd></div>
        <div className="is-wide"><dt>Archivo</dt><dd>{status?.lastFileName || 'Sin archivo todavía'}</dd></div>
        {status?.lastError && <div className="is-wide"><dt>Último error</dt><dd>{status.lastError}</dd></div>}
      </dl>
      <div className="ticket-detail-actions">
        <button className="button button--primary" type="button" onClick={createNow} disabled={Boolean(working)}><Icon name="backup" />{working === 'create' ? 'Creando respaldo...' : 'Crear respaldo ahora'}</button>
        {status?.lastUrl && <a className="button button--secondary" href={status.lastUrl} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Abrir último respaldo</a>}
        {status?.folderUrl && <a className="button button--secondary" href={status.folderUrl} target="_blank" rel="noreferrer"><Icon name="folder_open" />Abrir carpeta de respaldos</a>}
      </div>
    </section>

    <div className="info-box"><Icon name="info" /><p>Las evidencias, PDFs y otros archivos de Drive no se eliminan con una boleta o dispositivo: la aplicación usa eliminación lógica para conservar trazabilidad. El respaldo semanal protege la base de datos principal completa.</p></div>
  </div>;
}
