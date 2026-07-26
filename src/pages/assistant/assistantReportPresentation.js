function text(value, fallback = '—') {
  const clean = String(value ?? '').trim();
  return clean || fallback;
}

function checklistText(items = []) {
  if (!Array.isArray(items) || !items.length) return 'Sin checklist registrado';
  return items.map((item) => {
    const parts = [`${Number(item.yes || 0)} sí`];
    if (Number(item.no || 0)) parts.push(`${Number(item.no || 0)} no`);
    if (Number(item.other || 0)) parts.push(`${Number(item.other || 0)} otro`);
    return `${text(item.question)}: ${parts.join(', ')}`;
  }).join(' · ');
}

export function buildOperationalReportPresentation(facts = {}) {
  const tables = [];
  const stats = [];
  const maintenance = facts.maintenanceReport;
  const tickets = facts.ticketReport;

  if (maintenance) {
    stats.push(
      { label: 'Dispositivos', value: Number(maintenance.totalDevices || 0), icon: 'devices' },
      { label: 'En condición correcta', value: Number(maintenance.goodDevices || 0), icon: 'check_circle' },
      { label: 'Requieren atención', value: Number(maintenance.badDevices || 0), icon: 'warning' },
      { label: 'Evidencias', value: Number(maintenance.totalEvidence || 0), icon: 'photo_library' },
    );

    if (Array.isArray(maintenance.categories) && maintenance.categories.length) {
      tables.push({
        id: 'maintenance-category-report',
        title: 'Resumen por tipo de dispositivo',
        description: `${text(maintenance.title)}${maintenance.date ? ` · ${maintenance.date}` : ''}`,
        columns: [
          { key: 'category', label: 'Tipo de dispositivo', primary: true },
          { key: 'total', label: 'Total', numeric: true },
          { key: 'good', label: 'Bien', numeric: true, status: true },
          { key: 'bad', label: 'Con atención', numeric: true, status: true },
          { key: 'checklist', label: 'Verificaciones realizadas', wide: true },
        ],
        rows: maintenance.categories.map((category, index) => ({
          id: `maintenance-category-${index}`,
          category: text(category.category),
          total: Number(category.total || 0),
          good: Number(category.good || 0),
          bad: Number(category.bad || 0),
          checklist: checklistText(category.checklist),
        })),
      });
    }
  }

  if (tickets) {
    stats.push(
      { label: 'Boletas', value: Number(tickets.total || 0), icon: 'description' },
      { label: 'Finalizadas', value: Number(tickets.finalized || 0), icon: 'task_alt' },
      { label: 'Pendientes', value: Number(tickets.pending || 0), icon: 'pending_actions' },
      { label: 'Horas registradas', value: Number(tickets.totalHours || 0), icon: 'schedule' },
    );
  }

  return { tables, stats };
}
