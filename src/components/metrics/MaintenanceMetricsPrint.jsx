import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DonutBreakdown, formatMetric, ProgressBar } from './MetricsPrimitives';
import reportLogo from '../../assets/dms-report-logo.png?inline';
import { buildMaintenanceVisualReportModel } from '../../../backend/src/services/maintenance-visual-report.model.js';

function percentage(value, total) {
  return total > 0 ? (Number(value || 0) / total) * 100 : 0;
}

function maintenanceDate(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value || '')
    : new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

// Este documento usa los mismos agregados y primitivas del dashboard, sin duplicar consultas.
function MaintenanceMetricsPrint({ data }) {
  const charts = data?.charts || {};
  const client = data?.filtersApplied?.cliente || '';
  const date = data?.filtersApplied?.fecha || '';
  const operating = Number(charts.operating || 0);
  const failing = Number(charts.failing || 0);
  const activeUse = Number(charts.activeUse || 0);
  const stored = Number(charts.stored || 0);
  const total = operating + failing;
  const useTotal = activeUse + stored;
  // El backend entrega las filas según la selección del informe (no filtrar otra vez aquí).
  const rows = data?.detailRows || [];
  const reportMode = data?.filtersApplied?.detalleReporte || 'fallas';
  const detailTitles = {
    todos: 'Detalle de todos los dispositivos',
    no_operativos: 'Detalle de dispositivos con falla / sin dato',
    fallas: 'Detalle de averías confirmadas',
    funcionales: 'Detalle de dispositivos funcionales',
  };
  const detailDescriptions = {
    todos: 'Se incluyen dispositivos funcionales, averiados y sin estado de funcionamiento registrado.',
    no_operativos: 'Incluye equipos con fallas y sin datos de funcionamiento; los registros sin dato no son averías confirmadas.',
    fallas: 'Solo se incluyen dispositivos reportados como dañados o sin funcionamiento.',
    funcionales: 'Solo se incluyen dispositivos con funcionamiento positivo.',
  };

  return <main className={`report-page${rows.length <= 7 ? ' report-page--short' : ''}`}>
    <div className="report-header">
      <div className="report-context">
        <div className="report-context__item"><span>Cliente</span><strong>{client}</strong></div>
        <div className="report-context__item"><span>Fecha del mantenimiento</span><strong>{maintenanceDate(date)}</strong></div>
      </div>
      <img className="report-logo" src={reportLogo} alt="DMS Solutions Provider" />
    </div>

    <div className="report-main-charts">
      <section className="report-panel report-panel--functioning">
        <h2>Métricas del mantenimiento</h2>
        <p>Resumen del estado de los dispositivos registrados.</p>
        <DonutBreakdown total={total} items={[
          { label: 'Funcional', value: operating, color: '#58d0a0' },
          { label: 'Con falla / sin dato', value: failing, color: '#f1797c' },
        ]} />
      </section>
      <section className="report-panel report-panel--usage">
        <h2>Distribución de activos</h2>
        <p>Dispositivos según su uso o almacenamiento.</p>
        <div className="report-use-row">
          <div><strong>En uso</strong><b>{formatMetric(activeUse, 0)} ({percentage(activeUse, useTotal).toFixed(1)}%)</b></div>
          <ProgressBar value={percentage(activeUse, useTotal)} tone="primary" />
        </div>
        <div className="report-use-row">
          <div><strong>Almacenados</strong><b>{formatMetric(stored, 0)} ({percentage(stored, useTotal).toFixed(1)}%)</b></div>
          <ProgressBar value={percentage(stored, useTotal)} tone="muted" />
        </div>
      </section>
    </div>

    <div className="report-kpis">
      {[
        ['Total de dispositivos', total],
        ['Funcionales', operating],
        ['Con falla / sin dato', failing],
        ['En uso', activeUse],
        ['Almacenados', stored],
      ].map(([label, value]) => <div className="report-kpi" key={label}><span>{label}</span><strong>{formatMetric(value, 0)}</strong></div>)}
    </div>

    <section className="report-incidents">
      <h2>{detailTitles[reportMode] || detailTitles.fallas}</h2>
      <p>{formatMetric(rows.length, 0)} dispositivo(s). {detailDescriptions[reportMode] || detailDescriptions.fallas}</p>
      <MaintenanceReportTable rows={rows} />
    </section>
  </main>;
}

function MaintenanceReportTable({ rows, visual = false }) {
  return rows.length ? <table className="report-table">
        <colgroup><col style={{ width: '13%' }} /><col style={{ width: '14%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '28%' }} /></colgroup>
        <thead><tr><th>Zona / ubicación</th><th>Dispositivo</th><th>Categoría</th><th>Funcionamiento</th><th>Uso</th><th>Responsable</th><th>Observaciones</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.deviceId || index}>
          <td>{row.zona || 'Sin zona'}</td>
          <td><strong>{row.nombreDispositivo || 'Sin dispositivo'}</strong></td>
          <td>{row.categoria || 'Sin categoría'}</td>
          <td><span className={`report-status ${visual ? (row.salud.kind === 'sano' ? 'report-status--ok' : row.salud.kind === 'danado' ? 'report-status--fault' : 'report-status--unknown') : row.operativo ? 'report-status--ok' : row.averiado ? 'report-status--fault' : 'report-status--unknown'}`}>{row.funcionamiento || 'Sin dato'}</span>
            {visual ? <small className="report-fault-severity" data-severity={row.salud.rank}>{row.salud.kind === 'danado' ? row.salud.severity : row.salud.kind === 'sano' ? 'Sano' : 'Sin evaluar'}</small> : row.gravedadFalla && (row.averiado || row.estado === 'Mal estado') && <small className="report-fault-severity">Prioridad: {row.gravedadFalla}</small>}</td>
          <td>{row.enUso || 'Sin dato'}</td>
          <td>{row.creador || 'Sin responsable'}</td>
          <td className="report-observation">{row.observacion || 'Sin observaciones'}</td>
        </tr>)}</tbody>
      </table> : <div className="report-empty">No hay dispositivos para el tipo seleccionado en esta fecha.</div>;
}

function VisualReportBand({ children }) {
  return <h2 className="visual-report-band"><span>{children}</span></h2>;
}

function VisualCategoryChart({ categories }) {
  if (!categories.length) return <p>No hay dispositivos registrados.</p>;
  const max = categories.reduce((largest, category) => Math.max(largest, category.total), 1);
  const groups = [];
  for (let start = 0; start < categories.length; start += 5) groups.push(categories.slice(start, start + 5));
  return <div className="visual-category-groups">{groups.map((group, index) =>
    <div className="visual-category-chart" key={index} style={{ gridTemplateColumns: `repeat(${group.length}, minmax(0, 1fr))` }}>
      {group.map((category) => <div className="visual-category" key={category.categoria}>
        <div className="visual-category-track">
          <div className="visual-category-column" style={{ height: `${category.total / max * 100}%` }}>
            <strong>{category.total}</strong>
            {[['sanos', '#12805e'], ['danados', '#b90d19'], ['sinEvaluar', '#89919e']].map(([key, color]) => category[key] > 0 &&
              <span key={key} style={{ background: color, flex: category[key] }} />)}
          </div>
        </div>
        <b>{category.categoria}</b><small>{category.danados} fallas</small>
      </div>)}
    </div>)}</div>;
}

function MaintenanceVisualPrint({ model, recommendations }) {
  const health = model.health === null ? '—' : `${formatMetric(model.health, 1)}%`;
  const title = model.filter === 'danados' ? 'Dispositivos con fallas' : model.filter === 'sanos' ? 'Dispositivos en buen estado' : 'Detalle de dispositivos';
  const generatedDate = new Intl.DateTimeFormat('es-CR', { dateStyle: 'long', timeZone: 'America/Costa_Rica' }).format(new Date());
  return <main className="report-page report-page--visual">
    <header className="visual-report-header">
      <img className="report-logo" src={reportLogo} alt="DMS Solutions Provider" />
      <span>REPORTE DE MANTENIMIENTO</span>
    </header>
    <div className="visual-brand-line" />
    <h1>Cliente: {model.client}</h1>
    <p className="visual-report-subtitle">Informe de mantenimiento</p>
    <dl className="visual-report-context">
      <div><dt>Fecha del informe</dt><dd>{generatedDate}</dd></div>
      <div><dt>Responsables / Técnicos</dt><dd>{model.responsibleLabel || 'Sin responsable registrado'}</dd></div>
      <div><dt>Fecha del mantenimiento</dt><dd>{maintenanceDate(model.date)}</dd></div>
      <div><dt>Total de dispositivos</dt><dd>{model.total}</dd></div>
      <div><dt>Mantenimiento</dt><dd>{model.maintenanceLabel || 'No especificado'}</dd></div>
      <div><dt>Evidencias</dt><dd>{model.evidenceCount}</dd></div>
      {model.siteLabel && <div><dt>Ubicación</dt><dd>{model.siteLabel}</dd></div>}
    </dl>
    <VisualReportBand>Resumen general</VisualReportBand>
    <div className="report-kpis visual-report-kpis">{[
      ['Total de dispositivos', model.total, 'total'],
      ['En buen estado', model.healthy, 'ok'],
      ['Dispositivos con fallas', model.damaged, 'fault'],
      ['Salud general', health, 'health'],
    ].map(([label, value, tone]) => <div className={`report-kpi visual-kpi--${tone}`} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p className="visual-report-coverage">Evaluados: <b>{model.evaluated}</b> · Sin evaluar: <b>{model.pending}</b> · Cobertura: <b>{model.total ? formatMetric(model.evaluated / model.total * 100, 1) : '0'}%</b></p>
    <div className="visual-report-charts">
      <section className="report-panel visual-report-health">
        <VisualReportBand>Salud del sistema</VisualReportBand>
        <DonutBreakdown total={model.evaluated} centerValue={health} centerLabel="Salud" items={[
          { label: 'Buenos', value: model.healthy, color: '#12805e' },
          { label: 'Con fallas', value: model.damaged, color: '#b90d19' },
        ]} />
        <p>Salud = equipos sanos / evaluados. Los {model.pending} sin evaluar no se contabilizan como fallas.</p>
      </section>
      <section className="report-panel visual-report-types">
        <VisualReportBand>Distribución por tipo de dispositivo</VisualReportBand>
        <p className="visual-chart-legend"><span>● Buenos</span><span>● Con fallas</span><span>● Sin evaluar</span></p>
        <VisualCategoryChart categories={model.categories} />
      </section>
    </div>
    <section className="report-incidents">
      <VisualReportBand>{title}</VisualReportBand>
      <p>{model.rows.length} dispositivos incluidos · Orden: Crítica, Moderada, Leve, Sin clasificar, Sanos, Sin evaluar.</p>
      <MaintenanceReportTable rows={model.rows} visual />
    </section>
    {recommendations && <section className="visual-report-recommendations">
      <VisualReportBand>Recomendaciones</VisualReportBand>
      <div className="visual-recommendations-text">{recommendations}</div>
    </section>}
    <footer className="visual-report-footer"><div className="visual-brand-line" /><span>DMS Solutions Provider</span></footer>
  </main>;
}

const REPORT_STYLES = `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  html, body { padding: 0; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #202126; background: #fff; }
  button { font: inherit; }
  .report-page { padding: 8mm 9mm; background: #fff; }
  .report-header { display: grid; grid-template-columns: minmax(0, 1fr) 116px; align-items: center; gap: 16px; margin-bottom: 9px; }
  .report-context { min-width: 0; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.8fr); gap: 9px; }
  .report-context__item { min-width: 0; padding: 9px 12px; border: 1px solid #cfd3dc; border-left: 4px solid #b90d19; border-radius: 9px; }
  .report-context__item span { display: block; font-size: 10px; color: #555d6d; margin-bottom: 3px; }
  .report-context__item strong { display: block; font-size: 13px; line-height: 1.25; color: #16171c; overflow-wrap: anywhere; }
  .report-logo { display: block; width: 116px; height: auto; object-fit: contain; }
  .report-main-charts { display: grid; grid-template-columns: 1.4fr 1fr; gap: 10px; margin-bottom: 9px; }
  .report-panel { border: 1px solid #cfd3dc; border-radius: 11px; padding: 10px 12px; min-width: 0; }
  h2 { margin: 0; font-size: 16px; line-height: 1.2; border-left: 4px solid #b90d19; padding-left: 9px; }
  .report-panel > p, .report-incidents > p { margin: 4px 0 8px; color: #596070; font-size: 10px; }
  .metrics-donut-layout { display: grid; grid-template-columns: 113px minmax(0, 1fr); align-items: center; gap: 15px; }
  .metrics-donut { width: 113px; height: 113px; border-radius: 50%; display: grid; place-items: center; position: relative; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .metrics-donut::after { content: ''; position: absolute; inset: 20px; border-radius: 50%; background: #fff; }
  .metrics-donut > div { z-index: 1; text-align: center; }
  .metrics-donut strong { display: block; font-size: 23px; }
  .metrics-donut span { display: block; font-size: 10px; color: #586071; text-transform: uppercase; }
  .metrics-legend { display: grid; gap: 10px; }
  .metrics-legend button { display: flex; justify-content: space-between; gap: 8px; align-items: center; width: 100%; padding: 8px 10px; border-radius: 9px; border: 1px solid #e1e3e9; background: #f8f9fb; color: #1b1b1e; text-align: left; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .metrics-legend button > span { display: flex; align-items: center; gap: 8px; }
  .metrics-legend i { display: block; width: 10px; height: 10px; border-radius: 50%; }
  .report-use-row { border: 1px solid #e1e3e9; border-radius: 9px; padding: 9px 10px; margin-top: 7px; background: #f8f9fb; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .report-use-row > div:first-child { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; margin-bottom: 9px; }
  .metrics-progress { height: 8px; background: #e3e5ec; border-radius: 9px; overflow: hidden; }
  .metrics-progress > span { display: block; height: 100%; border-radius: 9px; background: #e54456; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .metrics-progress--muted > span { background: #858b96; }
  .report-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 0 0 11px; }
  .report-kpi { padding: 8px 10px; border: 1px solid #d6d9e0; border-radius: 9px; background: #f6f7f9; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .report-kpi span { display: block; min-height: 14px; color: #555d6d; font-size: 10px; }
  .report-kpi strong { display: block; font-size: 19px; margin-top: 4px; }
  .report-incidents h2 { font-size: 16px; }
  .report-table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #d4d8e0; }
  .report-table th { padding: 7px 8px; background: #24262e; color: #fff; font-size: 9.5px; text-align: left; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .report-table td { padding: 7px 8px; border-bottom: 1px solid #d9dce3; font-size: 9.5px; line-height: 1.35; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
  .report-table tbody tr:nth-child(even) { background: #f7f8fa; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .report-table thead { display: table-header-group; }
  .report-table tr { break-inside: avoid; page-break-inside: avoid; }
  .report-observation { white-space: pre-wrap; line-height: 1.4; }
  .report-status { display: inline-block; padding: 4px 6px; border-radius: 10px; font-weight: bold; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .report-status--fault { color: #a50013; background: #ffe6e7; }
  .report-status--ok { color: #06754c; background: #e3f8ee; }
  .report-status--unknown { color: #5b626d; background: #eceef2; }
  .report-fault-severity { display: block; margin-top: 3px; color: #9e111b; font-weight: bold; }
  .report-empty { padding: 26px; text-align: center; border: 1px dashed #ccd0d8; border-radius: 10px; color: #596070; }
  .print-controls { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; background: #26242a; color: #fff; }
  .print-controls__instructions { display: grid; gap: 4px; min-width: 230px; flex: 1; line-height: 1.4; }
  .print-controls__instructions strong { font-size: 13px; }
  .print-controls__instructions span { font-size: 12px; color: #e4dfe0; }
  .print-controls button { border: 0; border-radius: 8px; padding: 11px 16px; background: #b90d19; color: #fff; font-weight: bold; cursor: pointer; min-height: 42px; }
  .print-controls button:disabled { opacity: .6; cursor: wait; }
  @media (max-width: 600px) { .print-controls button { width: 100%; } }
  @media screen {
    body { background: #e7e8eb; }
    .report-page { max-width: 1160px; margin: 20px auto 36px; box-shadow: 0 8px 30px #0002; }
  }
  @media print {
    .print-controls { display: none !important; }
    /* Nunca limitar la altura del informe ni ocultar filas para intentar que quepa en una página. */
    html, body, .report-page, .report-incidents { height: auto !important; max-height: none !important; overflow: visible !important; }
    .report-page { box-shadow: none; margin: 0; }
    .report-header, .report-main-charts, .report-kpis { break-inside: avoid; page-break-inside: avoid; }
    .report-table { break-inside: auto !important; page-break-inside: auto !important; }
    .report-table thead { display: table-header-group; }
    .report-table tbody { break-inside: auto; page-break-inside: auto; }
    .report-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
    /* El formato compacto se usa solo en informes breves. Los largos fluyen a tantas páginas como requieran. */
    .report-page--short { padding: 6mm 8mm; }
    .report-page--short .report-main-charts { margin-bottom: 7px; }
    .report-page--short .report-kpis { margin-bottom: 8px; }
    .report-page--short .report-table th { padding-top: 6px; padding-bottom: 6px; }
    .report-page--short .report-table td { padding-top: 6px; padding-bottom: 6px; }
  }
`;

const VISUAL_REPORT_STYLES = `
  @page { size: A4 portrait; margin: 9mm 10mm; }
  .report-page--visual { padding: 0; font-size: 11px; }
  .visual-report-header { display: flex; justify-content: space-between; align-items: center; color: #555d6d; font-size: 10px; font-weight: bold; }
  .visual-report-header .report-logo { width: 130px; }
  .visual-brand-line { height: 5px; background: linear-gradient(135deg,#b90d19 0 73%,#e7e8eb 73%); margin: 6px 0 13px; }
  .report-page--visual h1 { margin: 0; color: #930b16; font-size: 24px; line-height: 1.2; overflow-wrap: anywhere; }
  .visual-report-subtitle { color: #555d6d; font-size: 17px; font-weight: bold; margin: 3px 0 10px; }
  .visual-report-context { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 0 14px; margin: 0 0 10px; padding: 8px 12px; border: 1px solid #cfd3dc; border-radius: 9px; background: #f6f7f9; }
  .visual-report-context div { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 8px; padding: 5px 0; border-bottom: 1px solid #d9dce3; overflow-wrap: anywhere; }
  .visual-report-context dt { font-weight: bold; }.visual-report-context dd { margin: 0; }
  .visual-report-band { margin: 10px 0 7px; padding: 0; border: 0; border-top: 2px solid #b90d19; border-radius: 4px; background: #e7e8eb; color: #fff; font-size: 14px; line-height: 1.2; break-after: avoid; page-break-after: avoid; }
  .visual-report-band span { display: inline-block; padding: 5px 23px 5px 9px; background: #b90d19; clip-path: polygon(0 0,100% 0,calc(100% - 14px) 100%,0 100%); }
  .visual-report-kpis { grid-template-columns: repeat(4,minmax(0,1fr)); margin-bottom: 5px; text-align: center; }
  .visual-report-kpis strong { font-size: 24px; color: #b90d19; }
  .visual-kpi--ok strong { color: #12805e; }
  .visual-report-coverage { margin: 5px 0 9px; color: #555d6d; }
  .visual-report-charts { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0,1.3fr); gap: 8px; align-items: start; }
  .visual-report-charts .report-panel { padding: 0 8px 7px; }
  .visual-report-charts .visual-report-band { margin: 0 -8px 8px; font-size: 12px; }
  .visual-report-charts .visual-report-band span { padding-right: 17px; }
  .visual-report-health .metrics-donut-layout { grid-template-columns: 92px minmax(0,1fr); gap: 8px; }
  .visual-report-health .metrics-donut { width: 92px; height: 92px; }
  .visual-report-health .metrics-donut::after { inset: 15px; }
  .visual-report-health .metrics-donut strong { font-size: 17px; }
  .visual-report-health .metrics-legend { gap: 5px; }
  .visual-report-health .metrics-legend button { padding: 5px; font-size: 10px; }
  .visual-report-health p { margin-top: 7px; }
  .visual-chart-legend { display: flex; flex-wrap: wrap; gap: 6px; }
  .visual-chart-legend span:nth-child(1) { color: #12805e; }
  .visual-chart-legend span:nth-child(2) { color: #b90d19; }
  .visual-chart-legend span:nth-child(3) { color: #626a77; }
  .visual-category-groups { display: grid; gap: 8px; }
  .visual-category-chart { display: grid; gap: 4px; break-inside: avoid; }
  .visual-category { display: grid; grid-template-rows: 76px auto auto; text-align: center; min-width: 0; overflow-wrap: anywhere; font-size: 8px; }
  .visual-category-track { display: flex; align-items: end; justify-content: center; border-bottom: 1px solid #cfd3dc; padding-top: 12px; }
  .visual-category-column { display: flex; flex-direction: column-reverse; width: min(60%,24px); position: relative; }
  .visual-category-column strong { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); }
  .visual-category-column span { min-height: 0; }
  .visual-category b { margin-top: 3px; }
  .visual-category small { color: #b90d19; font-size: 8px; }
  .report-page--visual .report-table th, .report-page--visual .report-table td { padding: 5px 4px; font-size: 9px; }
  .report-page--visual .report-fault-severity[data-severity="1"] { color: #a45d00; }
  .report-page--visual .report-fault-severity[data-severity="2"] { color: #806000; }
  .report-page--visual .report-fault-severity[data-severity="3"], .report-page--visual .report-fault-severity[data-severity="5"] { color: #5b626d; }
  .report-page--visual .report-fault-severity[data-severity="4"] { color: #12805e; }
  .visual-recommendations-text { padding: 10px; background: #f6f7f9; border: 1px solid #cfd3dc; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
  .visual-report-footer { margin-top: 14px; text-align: right; color: #555d6d; font-size: 9px; }
  .report-page--visual, .report-page--visual * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  @media screen { .report-page--visual { width: min(100%, 794px); padding: 9mm 10mm; } }
  @media print {
    .visual-report-header, .visual-report-context, .visual-report-kpis, .visual-report-health { break-inside: avoid; page-break-inside: avoid; }
    /* Large category collections flow normally instead of forcing an oversized panel onto a page. */
    .visual-report-charts { display: block; }
    .visual-report-health { margin-bottom: 8px; }
    .visual-report-charts:has(.visual-category-chart:only-child) { display: grid; break-inside: avoid; }
    .visual-report-footer { break-inside: avoid; }
  }
`;

export function openMaintenanceReportPreview() {
  const popup = window.open('', '_blank');
  if (!popup) return null;
  popup.opener = null;
  popup.document.title = 'Preparando métricas de mantenimiento';
  popup.document.body.textContent = 'Preparando las métricas del mantenimiento seleccionado…';
  return popup;
}

export function showMaintenanceReportError(popup, message) {
  if (popup && !popup.closed) popup.document.body.textContent = message;
}

export function assertCompleteMaintenanceReport(data) {
  if (!Array.isArray(data?.detailRows)) {
    throw new Error('La respuesta del informe no contiene una tabla de dispositivos válida.');
  }
  // El backend devuelve el total antes de serializar. No imprimir si el transporte truncó la lista.
  if (data.reportDetailCount !== null && data.reportDetailCount !== undefined
    && (!Number.isSafeInteger(data.reportDetailCount)
      || data.reportDetailCount < 0
      || data.reportDetailCount !== data.detailRows.length)) {
    throw new Error('El informe llegó incompleto. Vuelva a generarlo para incluir todos los dispositivos.');
  }
  const mode = data?.filtersApplied?.detalleReporte;
  const totalsByMode = {
    no_operativos: data?.charts?.failing,
    fallas: data?.charts?.confirmedFailures,
    funcionales: data?.charts?.operating,
    todos: data?.totals?.dispositivosFiltrados,
  };
  const expected = totalsByMode[mode];
  if (expected !== undefined && (!Number.isSafeInteger(expected)
    || expected !== data.detailRows.length)) {
    throw new Error('El número de dispositivos del PDF no coincide con las métricas del filtro elegido. No se generó un informe incompleto.');
  }
  return data.detailRows.length;
}

export function renderMaintenanceReport(popup, data, { format = 'pdf', visualFilter = 'todos', recommendations = '' } = {}) {
  if (!popup || popup.closed) return;
  const completeRows = assertCompleteMaintenanceReport(data);
  const visual = format === 'visual';
  const model = visual ? buildMaintenanceVisualReportModel(data, visualFilter) : null;
  const expectedRows = visual ? model.rows.length : completeRows;
  const client = data?.filtersApplied?.cliente || 'Cliente';
  const date = data?.filtersApplied?.fecha || 'Fecha';
  const mode = visual ? `visual-${visualFilter}` : data?.filtersApplied?.detalleReporte || 'fallas';
  const filename = `DMS-Mantenimiento-${client}-${date}-${mode}`
    .replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 90);
  const reportMarkup = renderToStaticMarkup(visual
    ? <MaintenanceVisualPrint model={model} recommendations={String(recommendations || '').trim()} />
    : <MaintenanceMetricsPrint data={data} />);
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${filename}</title><style>${REPORT_STYLES}${visual ? VISUAL_REPORT_STYLES : ''}</style></head><body><div class="print-controls"><div class="print-controls__instructions"><strong>${expectedRows} dispositivos incluidos · Un único PDF con todas las páginas</strong><span>Pulse «Guardar PDF completo». En el diálogo seleccione Destino: Guardar como PDF y Páginas: Todas (no «Personalizadas» ni «Página actual»).</span></div><button id="print-report" type="button" disabled>Preparando documento completo...</button></div>${reportMarkup}</body></html>`);
  popup.document.close();
  const renderedRows = popup.document.querySelectorAll('.report-table tbody tr').length;
  if (renderedRows !== expectedRows) {
    throw new Error('No se dibujaron todos los dispositivos en el PDF. Vuelva a generar el informe.');
  }
  const printButton = popup.document.getElementById('print-report');
  let ready = false;
  printButton?.addEventListener('click', () => {
    // Una sola llamada a imprimir: la opción «Todas» reúne las páginas en el mismo PDF.
    if (ready && !popup.closed) popup.print();
  });
  popup.focus();
  // El usuario confirma la impresión cuando la vista está lista; evita imprimir
  // automáticamente una sola página o reutilizar sin darse cuenta un rango anterior.
  Promise.resolve(popup.document.fonts?.ready).then(async () => {
    await Promise.all(Array.from(popup.document.images, (img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
    if (popup.closed) return;
    await new Promise((resolve) => {
      popup.requestAnimationFrame(() => popup.requestAnimationFrame(resolve));
    });
    if (popup.closed) return;
    ready = true;
    if (printButton) {
      printButton.disabled = false;
      printButton.textContent = 'Guardar PDF completo';
    }
  }).catch(() => {
    // El botón se habilita incluso si una fuente/imágen no confirma su carga.
    // Los datos ya están completos y el usuario puede imprimir manualmente.
    ready = true;
    if (printButton && !popup.closed) {
      printButton.disabled = false;
      printButton.textContent = 'Guardar PDF completo';
    }
  });
}
