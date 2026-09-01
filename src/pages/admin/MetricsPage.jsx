import React, { Suspense, lazy, useState } from 'react';
import Icon from '../../components/common/Icon';

const TicketMetricsDashboard = lazy(() => import('../../components/metrics/TicketMetricsDashboard'));
const MaintenanceMetricsDashboard = lazy(() => import('../../components/metrics/MaintenanceMetricsDashboard'));
const ActivityReportsDashboard = lazy(() => import('../../components/metrics/ActivityReportsDashboard'));

function DashboardLoading() {
  return <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Preparando información...</span></div>;
}

export default function MetricsPage() {
  const [tab, setTab] = useState('tickets');
  return <div className="page metrics-page">
    <header className="metrics-page__hero">
      <div><span className="eyebrow">Panel administrativo</span><h1>Métricas y reportes</h1><p>Seguimiento de boletas, mantenimientos y actividad detallada de usuarios con información actualizada desde DMS y Google Sheets.</p></div>
      <span className="metrics-page__hero-icon"><Icon name="monitoring" /></span>
    </header>

    <nav className="metrics-tabs" aria-label="Tipo de dashboard">
      <button type="button" className={tab === 'tickets' ? 'is-active' : ''} onClick={() => setTab('tickets')}><Icon name="receipt_long" />Boletas</button>
      <button type="button" className={tab === 'maintenance' ? 'is-active' : ''} onClick={() => setTab('maintenance')}><Icon name="engineering" />Mantenimientos</button>
      <button type="button" className={tab === 'activity' ? 'is-active' : ''} onClick={() => setTab('activity')}><Icon name="manage_search" />Reportes de actividad</button>
    </nav>

    <Suspense fallback={<DashboardLoading />}>
      {tab === 'tickets'
        ? <TicketMetricsDashboard />
        : tab === 'maintenance'
          ? <MaintenanceMetricsDashboard />
          : <ActivityReportsDashboard />}
    </Suspense>
  </div>;
}