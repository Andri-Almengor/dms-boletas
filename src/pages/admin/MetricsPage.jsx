import React, { useState } from 'react';
import Icon from '../../components/common/Icon';
import MaintenanceMetricsDashboard from '../../components/metrics/MaintenanceMetricsDashboard';
import TicketMetricsDashboard from '../../components/metrics/TicketMetricsDashboard';

export default function MetricsPage() {
  const [tab, setTab] = useState('tickets');
  return <div className="page metrics-page">
    <header className="metrics-page__hero">
      <div><span className="eyebrow">Panel administrativo</span><h1>Métricas operativas</h1><p>Seguimiento de boletas y mantenimientos con información actualizada directamente desde Google Sheets.</p></div>
      <span className="metrics-page__hero-icon"><Icon name="monitoring" /></span>
    </header>

    <nav className="metrics-tabs" aria-label="Tipo de dashboard">
      <button type="button" className={tab === 'tickets' ? 'is-active' : ''} onClick={() => setTab('tickets')}><Icon name="receipt_long" />Boletas</button>
      <button type="button" className={tab === 'maintenance' ? 'is-active' : ''} onClick={() => setTab('maintenance')}><Icon name="engineering" />Mantenimientos</button>
    </nav>

    {tab === 'tickets' ? <TicketMetricsDashboard /> : <MaintenanceMetricsDashboard />}
  </div>;
}
