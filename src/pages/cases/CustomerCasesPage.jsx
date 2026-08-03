import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import {
  CUSTOMER_CASE_ROUTES,
  customerCaseStateLabel,
  customerCaseView,
  requestCustomerCase,
} from '../../services/customerCases';
import '../../styles/customer-cases.css';
import '../../styles/customer-cases-polish.css';
import '../../styles/customer-cases-evidence-status.css';
import '../../styles/customer-cases-workflow.css';

const STATUS_TABS = Object.freeze([
  { value: '', label: 'Todos', icon: 'inbox', countKey: 'TOTAL' },
  { value: 'EN_ESPERA', label: 'En espera', icon: 'schedule', countKey: 'EN_ESPERA' },
  { value: 'EN_PROCESO', label: 'En proceso', icon: 'engineering', countKey: 'EN_PROCESO' },
  { value: 'FINALIZADO', label: 'Finalizados', icon: 'task_alt', countKey: 'FINALIZADO' },
]);

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || 'Sin fecha');
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function stateClass(state) {
  if (state === 'EN_PROCESO') return 'is-process';
  if (state === 'FINALIZADO') return 'is-finished';
  return 'is-waiting';
}

function evidenceLabel(item) {
  const requested = Math.max(Number(item.requestedEvidenceCount || 0), item.evidenceCount);
  if (!requested) return '0 evidencias';
  if (item.failedEvidenceCount || item.evidenceCount < requested) {
    return `${item.evidenceCount}/${requested} evidencias`;
  }
  return `${item.evidenceCount} evidencia${item.evidenceCount === 1 ? '' : 's'}`;
}

export default function CustomerCasesPage() {
  const { sessionToken } = useAuth();
  const [cases, setCases] = useState([]);
  const [counts, setCounts] = useState({ TOTAL: 0, EN_ESPERA: 0, EN_PROCESO: 0, FINALIZADO: 0 });
  const [modeCounts, setModeCounts] = useState({ REAL: 0, TEST: 0, ALL: 0 });
  const [mode, setMode] = useState('REAL');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await requestCustomerCase(CUSTOMER_CASE_ROUTES.list, {
        status,
        mode,
        search: submittedSearch,
        page: 1,
        pageSize: 200,
      }, sessionToken);
      setCases((response.items || []).map(customerCaseView));
      setCounts(response.counts || { TOTAL: 0, EN_ESPERA: 0, EN_PROCESO: 0, FINALIZADO: 0 });
      setModeCounts(response.modeCounts || { REAL: 0, TEST: 0, ALL: 0 });
    } catch (loadError) {
      setError(loadError.message || 'No se pudieron cargar los casos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionToken, status, mode, submittedSearch]);

  useEffect(() => { load(); }, [load]);

  const visibleCases = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query || query === submittedSearch.toLowerCase()) return cases;
    return cases.filter((item) => `${item.number} ${item.client} ${item.reason} ${item.problem} ${item.requesterName} ${item.requesterEmail}`.toLowerCase().includes(query));
  }, [cases, search, submittedSearch]);

  function submitSearch(event) {
    event.preventDefault();
    const next = search.trim();
    if (next === submittedSearch) load({ quiet: true });
    else setSubmittedSearch(next);
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setStatus('');
    setSearch('');
    setSubmittedSearch('');
  }

  return <div className="page customer-cases-page">
    <header className="case-dashboard-heading">
      <div><span className="eyebrow">Mesa de ayuda</span><h1>Casos de clientes</h1><p>Solicitudes enviadas desde los enlaces reutilizables de cada cliente.</p></div>
      <div className="case-dashboard-heading__actions">
        <div className="case-mode-switch" role="tablist" aria-label="Tipo de casos">
          <button type="button" className={mode === 'REAL' ? 'is-active' : ''} onClick={() => changeMode('REAL')} role="tab" aria-selected={mode === 'REAL'}><Icon name="support_agent" />Casos reales <b>{modeCounts.REAL || 0}</b></button>
          <button type="button" className={`is-test${mode === 'TEST' ? ' is-active' : ''}`} onClick={() => changeMode('TEST')} role="tab" aria-selected={mode === 'TEST'}><Icon name="science" />Pruebas <b>{modeCounts.TEST || 0}</b></button>
        </div>
        <button className="button button--secondary button--compact" type="button" onClick={() => load({ quiet: true })} disabled={refreshing}><Icon name={refreshing ? 'progress_activity' : 'refresh'} />{refreshing ? 'Actualizando...' : 'Actualizar'}</button>
      </div>
    </header>

    {mode === 'TEST' && <div className="case-test-banner"><Icon name="science" /><div><strong>Mostrando casos de prueba</strong><span>Estos casos no notifican a coordinación y sus boletas no consumen el consecutivo real.</span></div></div>}

    <section className="case-kpi-grid">
      <article><span className="case-kpi-icon"><Icon name={mode === 'TEST' ? 'science' : 'inbox'} /></span><div><strong>{counts.TOTAL || 0}</strong><span>{mode === 'TEST' ? 'Pruebas' : 'Total'}</span></div></article>
      <article><span className="case-kpi-icon is-waiting"><Icon name="schedule" /></span><div><strong>{counts.EN_ESPERA || 0}</strong><span>En espera</span></div></article>
      <article><span className="case-kpi-icon is-process"><Icon name="engineering" /></span><div><strong>{counts.EN_PROCESO || 0}</strong><span>En proceso</span></div></article>
      <article><span className="case-kpi-icon is-finished"><Icon name="task_alt" /></span><div><strong>{counts.FINALIZADO || 0}</strong><span>Finalizados</span></div></article>
    </section>

    <section className="case-dashboard-toolbar">
      <div className="case-status-tabs" role="tablist" aria-label="Filtrar casos por estado">
        {STATUS_TABS.map((tab) => <button key={tab.value || 'all'} type="button" className={status === tab.value ? 'is-active' : ''} onClick={() => setStatus(tab.value)} role="tab" aria-selected={status === tab.value}><Icon name={tab.icon} /><span>{tab.label}</span><b>{counts[tab.countKey] || 0}</b></button>)}
      </div>
      <form className="case-search" onSubmit={submitSearch}><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar caso, cliente o solicitante..." /><button type="submit" aria-label="Buscar"><Icon name="search" /></button></form>
    </section>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando casos...</div>
      : visibleCases.length ? <section className="customer-case-card-grid">
        {visibleCases.map((item) => {
          const evidenceWarning = item.failedEvidenceCount > 0
            || item.evidenceCount < Number(item.requestedEvidenceCount || 0);
          return <Link to={`/casos/${encodeURIComponent(item.id)}`} className={`customer-case-card ${stateClass(item.state)}${evidenceWarning ? ' has-evidence-warning' : ''}`} key={item.id}>
            <header><div><span className="customer-case-card__number">{item.number}</span>{item.testMode && <span className="customer-case-card__test"><Icon name="science" />Prueba</span>}<strong>{item.client}</strong></div><span className={`case-status-pill ${stateClass(item.state)}`}><Icon name={item.state === 'FINALIZADO' ? 'task_alt' : item.state === 'EN_PROCESO' ? 'engineering' : 'schedule'} />{customerCaseStateLabel(item.state)}</span></header>
            <h2>{item.reason || 'Solicitud técnica'}</h2>
            <p>{item.problem || 'Sin descripción del problema.'}</p>
            <div className="customer-case-card__meta"><span><Icon name="person" />{item.requesterName || 'Sin solicitante'}</span><span className={evidenceWarning ? 'is-warning' : ''}><Icon name={evidenceWarning ? 'warning' : 'photo_library'} />{evidenceLabel(item)}</span>{item.state === 'EN_PROCESO' && item.technicianNames && <span><Icon name="engineering" />{item.technicianNames}</span>}</div>
            <footer><span>{dateLabel(item.createdAt)}</span>{item.ticketNumber && <span>{item.testMode ? item.ticketNumber : `Boleta #${item.ticketNumber}`}</span>}<Icon name="arrow_forward" /></footer>
          </Link>;
        })}
      </section>
        : <div className="empty-state case-empty-state"><Icon name={mode === 'TEST' ? 'science' : 'support_agent'} /><h2>{mode === 'TEST' ? 'No hay pruebas en esta etapa' : 'No hay casos en esta etapa'}</h2><p>{mode === 'TEST' ? 'Utilice el enlace de prueba disponible dentro del cliente.' : 'Los nuevos formularios aparecerán aquí automáticamente.'}</p></div>}
  </div>;
}
