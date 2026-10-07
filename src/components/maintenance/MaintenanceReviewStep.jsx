import React, { useMemo } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import MaintenanceDeviceProgressSummary from './MaintenanceDeviceProgressSummary';
import useMaintenanceDeviceCatalogData from '../../hooks/useMaintenanceDeviceCatalogData';
import { isProjectMaintenance } from '../../features/maintenance/maintenanceType';
import { projectChecklistOverallProgress } from '../../features/maintenance/maintenanceProjectChecklist';

export default function MaintenanceReviewStep({ form, devices, registered, expectedTotal, disabled, saving, onSave, onFinalize, canFinalize = false }) {
  const { sessionToken } = useAuth();
  const { catalogs } = useMaintenanceDeviceCatalogData(sessionToken, {
    resources: ['deviceTypes'],
  });
  const deviceTypes = catalogs.deviceTypes;
  const projectMode = isProjectMaintenance(form.tipoMantenimiento);
  const projectProgress = useMemo(
    () => projectChecklistOverallProgress(form.projectChecklist, devices),
    [form.projectChecklist, devices],
  );

  return <div className="maintenance-review">
    <div className="maintenance-review__hero"><Icon name={projectMode ? 'account_tree' : 'fact_check'} /><div><span className="eyebrow">{projectMode ? 'Resumen del proyecto' : 'Resumen'}</span><h3>{form.titulo || (projectMode ? 'Proyecto sin título' : 'Mantenimiento sin título')}</h3><p>{form.cliente || 'Sin cliente'} · {form.ubicacion || 'Sin ubicación'}</p></div></div>
    <MaintenanceDeviceProgressSummary
      counts={form.counts}
      devices={devices}
      registered={registered}
      deviceTypes={deviceTypes}
      expectedTotal={expectedTotal}
      projectMode={projectMode}
      projectProgress={projectProgress}
    />
    {projectMode && projectProgress.total > 0 && <div className="maintenance-project-review-progress"><div><span>Checklist completado</span><strong>{projectProgress.completed}/{projectProgress.total}</strong></div><div className="maintenance-project-progress__track"><span style={{ width: `${projectProgress.percent}%` }} /></div><small>{projectProgress.pending} tarea{projectProgress.pending === 1 ? '' : 's'} pendiente{projectProgress.pending === 1 ? '' : 's'}.</small></div>}
    {projectMode && <div className="info-box"><Icon name="info" /><p>El Proyecto se guarda como pendiente y conserva sus dispositivos, relaciones y checklist de progreso. No usa firma general ni genera boletas automáticas de mantenimiento.</p></div>}
    {!disabled && <div className="maintenance-final-actions"><button className="button button--secondary" type="button" onClick={onSave} disabled={saving}><Icon name="save" />Guardar pendiente</button>{canFinalize && <button className="button button--primary" type="button" onClick={onFinalize} disabled={saving}><Icon name="task_alt" />Finalizar mantenimiento</button>}</div>}
  </div>;
}
