import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { fetchActivityReport } from '../../services/activityReportApi';
import { exportActivityReport, formatDuration } from '../../services/activityReportExport';
import '../../styles/activity-reports.css';

const SECTIONS = [
  ['AGENDA', 'Agenda'],
  ['BOLETAS', 'Boletas'],
  ['MANTENIMIENTOS', 'Mantenimientos'],
  ['DISPOSITIVOS', 'Dispositivos de mantenimiento'],
  ['CASOS', 'Casos de clientes'],
  ['CLIENTES', 'Clientes'],
  ['CREDENCIALES', 'Credenciales'],
  ['CATALOGOS', 'Catálogos'],
  ['USUARIOS', 'Usuarios'],
  ['CONOCIMIENTO', 'Base de conocimientos'],
  ['ASISTENTE', 'Asistente'],
  ['METRICAS', 'Métricas'],
  ['ENCUESTAS', 'Encuestas'],
  ['INTEGRACIONES', 'Integraciones'],
  ['ADMINISTRACION', 'Administración'],
  ['INICIO', 'Inicio'],
  ['OTROS', 'Otros'],
];

function clean(value) { return String(value ?? '').trim(); }
function personName(user = {}) { return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo || 'Usuario'); }
function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function subtractDays(days) { const date = new Date(); date.setDate(date.getDate() - days); return dateKey(date); }
function monthStart() { const now = new Date(); return dateKey(new Date(now.getFullYear(), now.getMonth(), 1)); }
function asUsers(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.users)) return response.users;
  return [];
}
function toggleValue(values, value) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

function SummaryCard({ icon, label, value, detail }) {
  return <article className="activity-summary-card"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong>{detail && <em>{detail}</em>}</div></article>;
}

function ReportFilters({ users, filters, setFilters, onRun, busy, format, setFormat, onExport, canExport }) {
  const selectedSet = useMemo(() => new Set(filters.userIds), [filters.userIds]);
  const allSelected = users.length > 0 && users.every((user) => selectedSet.has(clean(user.UsuarioID)));
  return <section className="activity-report-filters">
    <div className="activity-filter-heading"><div><span className="eyebrow">Constructor de reporte</span><h2>Filtros</h2><p>Combine personas, fechas, horas, secciones y contenido. El archivo exportado conserva todos los registros encontrados.</p></div><Icon name="tune" /></div>

    <div className="activity-filter-grid">
      <label><span>Fecha desde</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
      <label><span>Fecha hasta</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
      <label><span>Hora desde</span><input type="time" value={filters.timeFrom} onChange={(event) => setFilters((current) => ({ ...current, timeFrom: event.target.value }))} /></label>
      <label><span>Hora hasta</span><input type="time" value={filters.timeTo} onChange={(event) => setFilters((current) => ({ ...current, timeTo: event.target.value }))} /></label>
    </div>

    <div className="activity-filter-presets">
      <button type="button" className="button button--secondary button--compact" onClick={() => setFilters((current) => ({ ...current, dateFrom: dateKey(), dateTo: dateKey() }))}>Hoy</button>
      <button type="button" className="button button--secondary button--compact" onClick={() => setFilters((current) => ({ ...current, dateFrom: subtractDays(6), dateTo: dateKey() }))}>Últimos 7 días</button>
      <button type="button" className="button button--secondary button--compact" onClick={() => setFilters((current) => ({ ...current, dateFrom: monthStart(), dateTo: dateKey() }))}>Este mes</button>
      <button type="button" className="button button--secondary button--compact" onClick={() => setFilters((current) => ({ ...current, timeFrom: '', timeTo: '' }))}>Todo el día</button>
    </div>

    <div className="activity-filter-block">
      <div className="activity-filter-block__title"><div><strong>Personas</strong><small>Puede seleccionar una, varias o todas.</small></div><button type="button" className="button button--secondary button--compact" onClick={() => setFilters((current) => ({ ...current, userIds: allSelected ? [] : users.map((user) => clean(user.UsuarioID)) }))}>{allSelected ? 'Quitar todos' : 'Seleccionar todos'}</button></div>
      <div className="activity-user-grid">{users.map((user) => {
        const id = clean(user.UsuarioID);
        const checked = selectedSet.has(id);
        return <button type="button" key={id} className={`activity-user-option${checked ? ' is-selected' : ''}`} onClick={() => setFilters((current) => ({ ...current, userIds: toggleValue(current.userIds, id) }))}><Icon name={checked ? 'check_circle' : 'radio_button_unchecked'} /><span><strong>{personName(user)}</strong><small>{clean(user.Correo)}</small></span></button>;
      })}</div>
      {!filters.userIds.length && <div className="activity-filter-hint"><Icon name="info" />Sin selección explícita: el reporte incluirá todos los usuarios activos.</div>}
    </div>

    <div className="activity-filter-block">
      <div className="activity-filter-block__title"><div><strong>Secciones del app</strong><small>Vacío significa toda la aplicación.</small></div><button type="button" className="button button--secondary button--compact" onClick={() => setFilters((current) => ({ ...current, sections: [] }))}>Toda la app</button></div>
      <div className="activity-section-grid">{SECTIONS.map(([value, label]) => <button type="button" key={value} className={filters.sections.includes(value) ? 'is-selected' : ''} onClick={() => setFilters((current) => ({ ...current, sections: toggleValue(current.sections, value) }))}><Icon name={filters.sections.includes(value) ? 'check' : 'add'} />{label}</button>)}</div>
    </div>

    <div className="activity-filter-options">
      <label><input type="checkbox" checked={filters.contentTypes.includes('ACTIVITY')} onChange={() => setFilters((current) => ({ ...current, contentTypes: toggleValue(current.contentTypes, 'ACTIVITY') }))} /><span><strong>Actividad del app</strong><small>Páginas, pestañas, consultas, cambios y acciones.</small></span></label>
      <label><input type="checkbox" checked={filters.contentTypes.includes('AGENDA')} onChange={() => setFilters((current) => ({ ...current, contentTypes: toggleValue(current.contentTypes, 'AGENDA') }))} /><span><strong>Agenda</strong><small>Dónde debía ir la persona y en qué horario.</small></span></label>
      <label><input type="checkbox" checked={filters.includeReads} onChange={(event) => setFilters((current) => ({ ...current, includeReads: event.target.checked }))} /><span><strong>Incluir consultas</strong><small>Incluye abrir/listar datos, no solo modificaciones.</small></span></label>
      <label><input type="checkbox" checked={filters.includeHistoricalAudit} onChange={(event) => setFilters((current) => ({ ...current, includeHistoricalAudit: event.target.checked }))} /><span><strong>Usar auditoría histórica</strong><small>Recupera actividad previa al nuevo rastreo cuando exista.</small></span></label>
    </div>

    <div className="activity-export-bar">
      <label><span>Formato de salida</span><select value={format} onChange={(event) => setFormat(event.target.value)}><option value="PDF">PDF</option><option value="EXCEL">Excel (.xls)</option><option value="WORD">Word (.doc)</option></select></label>
      <button type="button" className="button button--secondary" onClick={onRun} disabled={busy}><Icon name={busy ? 'progress_activity' : 'preview'} />{busy ? 'Consultando...' : 'Previsualizar'}</button>
      <button type="button" className="button button--primary" onClick={onExport} disabled={busy || !canExport}><Icon name="download" />Exportar {format === 'PDF' ? 'PDF' : format === 'EXCEL' ? 'Excel' : 'Word'}</button>
    </div>
  </section>;
}

export default function ActivityReportsDashboard() {
  const { sessionToken } = useAuth();
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({
    userIds: [], sections: [], contentTypes: ['ACTIVITY', 'AGENDA'],
    dateFrom: dateKey(), dateTo: dateKey(), timeFrom: '', timeTo: '',
    includeReads: true, includeHistoricalAudit: true,
  });
  const [format, setFormat] = useState('PDF');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest('users.list', {}, sessionToken).then((response) => {
      if (!active) return;
      setUsers(asUsers(response).filter((user) => clean(user.Estado).toUpperCase() === 'ACTIVO'));
    }).catch((error) => { if (active) setMessage(error?.message || 'No se pudieron cargar los usuarios.'); });
    return () => { active = false; };
  }, [sessionToken]);

  async function runReport() {
    if (!filters.contentTypes.length) { setMessage('Seleccione Actividad del app, Agenda o ambos.'); return null; }
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) { setMessage('La fecha desde no puede ser posterior a la fecha hasta.'); return null; }
    if (filters.timeFrom && filters.timeTo && filters.timeFrom > filters.timeTo) { setMessage('La hora desde no puede ser posterior a la hora hasta.'); return null; }
    setBusy(true); setMessage('');
    try {
      const data = await fetchActivityReport(sessionToken, filters);
      setReport(data);
      return data;
    } catch (error) {
      setReport(null);
      setMessage(error?.message || 'No se pudo generar el reporte.');
      return null;
    } finally { setBusy(false); }
  }

  async function exportReport() {
    const data = report || await runReport();
    if (!data) return;
    exportActivityReport(data, format);
  }

  const previewRows = (report?.timeline || []).slice(0, 250);
  return <div className="activity-reports-dashboard">
    <ReportFilters users={users} filters={filters} setFilters={setFilters} onRun={runReport} busy={busy} format={format} setFormat={setFormat} onExport={exportReport} canExport={Boolean(report)} />
    {message && <div className="activity-report-message is-error"><Icon name="error" />{message}</div>}

    {report && <>
      <section className="activity-report-summary">
        <SummaryCard icon="touch_app" label="Acciones" value={report.summary.actions} detail={`${report.summary.highPriorityActions} de alta importancia`} />
        <SummaryCard icon="schedule" label="Tiempo activo" value={formatDuration(report.summary.pageTimeSeconds)} detail="pestañas visibles y activas" />
        <SummaryCard icon="receipt_long" label="Boletas" value={report.summary.ticketsTouched} detail="creadas, consultadas o modificadas" />
        <SummaryCard icon="engineering" label="Mantenimientos" value={report.summary.maintenancesTouched} detail={`${report.summary.devicesTouched} dispositivos tocados`} />
        <SummaryCard icon="calendar_month" label="Agenda" value={report.summary.agendaItems} detail="visitas dentro del periodo" />
      </section>

      <div className="activity-coverage-note"><Icon name="verified_user" /><div><strong>Cobertura del reporte</strong><span>{report.coverage.note}</span>{report.coverage.telemetryStartedAt && <small>Telemetría exacta desde: {new Date(report.coverage.telemetryStartedAt).toLocaleString('es-CR')}</small>}</div></div>

      <section className="activity-report-section">
        <header><div><span className="eyebrow">Uso del sistema</span><h3>Tiempo por pestaña y vista</h3></div><strong>{formatDuration(report.summary.pageTimeSeconds)}</strong></header>
        <div className="activity-page-time-list">{(report.pageSummary || []).slice(0, 100).map((row, index) => <div key={`${row.userId}-${row.section}-${row.route}-${row.view}-${index}`}><span><strong>{row.view || row.route || 'Vista general'}</strong><small>{row.userName} · {row.section}</small></span><b>{formatDuration(row.durationSeconds)}</b></div>)}</div>
        {!report.pageSummary?.length && <p className="activity-empty">No hay tiempo de permanencia registrado para estos filtros.</p>}
      </section>

      <section className="activity-report-section">
        <header><div><span className="eyebrow">Trazabilidad</span><h3>Actividad completa</h3><p>La previsualización muestra hasta 250 filas; el archivo exportado incluye todas.</p></div><strong>{report.timeline.length} registros</strong></header>
        <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Fecha / hora</th><th>Persona</th><th>Sección / vista</th><th>Acción</th><th>Objeto</th><th>Resultado</th></tr></thead><tbody>{previewRows.map((row, index) => <tr key={`${row.activityId}-${index}`} className={row.priority === 'ALTA' ? 'is-high-priority' : ''}><td>{row.dateTimeLabel}</td><td>{row.userName}</td><td><strong>{row.section}</strong>{row.view && <small>{row.view}</small>}</td><td><strong>{row.action}</strong><small>{row.actionRoute || row.source}</small></td><td>{row.entity || '—'}{row.entityId && <small>{row.entityId}</small>}</td><td><span className={`activity-result is-${String(row.result).toLowerCase()}`}>{row.result}</span></td></tr>)}</tbody></table></div>
        {!previewRows.length && <p className="activity-empty">No se encontró actividad para los filtros seleccionados.</p>}
      </section>

      <section className="activity-report-section">
        <header><div><span className="eyebrow">Cambios relevantes</span><h3>Boletas, mantenimientos, dispositivos y otros objetos</h3></div><strong>{report.entitySummary.length}</strong></header>
        <div className="activity-entity-grid">{(report.entitySummary || []).slice(0, 120).map((row, index) => <article key={`${row.userId}-${row.entity}-${row.entityId}-${index}`}><Icon name={row.entity === 'Boleta' ? 'receipt_long' : row.entity === 'Mantenimiento' ? 'engineering' : row.entity === 'DispositivoMantenimiento' ? 'devices' : 'history'} /><div><strong>{row.entity}{row.entityId ? ` · ${row.entityId}` : ''}</strong><span>{row.userName} · {row.section}</span><small>{row.actions.join(', ')}</small></div></article>)}</div>
      </section>

      <section className="activity-report-section">
        <header><div><span className="eyebrow">Programación</span><h3>Agenda de las personas seleccionadas</h3><p>Muestra dónde debían estar, horario, estado y si existe boleta relacionada.</p></div><strong>{report.agenda.length}</strong></header>
        <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Fecha</th><th>Horario</th><th>Destino / detalle</th><th>Asignados</th><th>Estado</th><th>Boleta</th></tr></thead><tbody>{report.agenda.map((row) => <tr key={row.agendaId}><td>{row.date}</td><td>{row.startTime} – {row.endTime}</td><td>{row.detail}</td><td>{row.assigned.map((user) => user.userName).join(', ')}</td><td>{row.status}</td><td>{row.ticketUid || (row.requiresTicket ? 'Pendiente' : 'No requiere')}</td></tr>)}</tbody></table></div>
        {!report.agenda.length && <p className="activity-empty">No hay agendas dentro del periodo y filtros seleccionados.</p>}
      </section>
    </>}
  </div>;
}
