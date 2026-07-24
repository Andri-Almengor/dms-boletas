import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { buildDynamicMaintenanceCategories } from '../../config/dynamicMaintenanceTypes';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../../services/moduleApi';

export default function MaintenanceReviewStep({ form, devices, registered, expectedTotal, disabled, saving, onSave, onFinalize, canFinalize = false }) {
  const { sessionToken } = useAuth();
  const [deviceTypes, setDeviceTypes] = useState([]);
  const evidenceCount = devices.reduce((sum, item) => sum + item.images.length + item.newImages.length, 0);

  useEffect(() => {
    let active = true;
    requestAvailable(MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 1000, activo: true }, sessionToken)
      .then((data) => {
        if (active) setDeviceTypes(normalizeItems(data));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [sessionToken]);

  const categories = useMemo(
    () => buildDynamicMaintenanceCategories(deviceTypes, { counts: form.counts, registered })
      .filter((item) => Number(form.counts[item.countField] || 0) > 0 || Number(registered[item.key] || 0) > 0),
    [deviceTypes, form.counts, registered],
  );

  return <div className="maintenance-review">
    <div className="maintenance-review__hero"><Icon name="fact_check" /><div><span className="eyebrow">Resumen</span><h3>{form.titulo || 'Mantenimiento sin título'}</h3><p>{form.cliente || 'Sin cliente'} · {form.ubicacion || 'Sin ubicación'}</p></div></div>
    <div className="maintenance-review__stats"><div><strong>{expectedTotal}</strong><span>esperados</span></div><div><strong>{devices.length}</strong><span>registrados</span></div><div><strong>{evidenceCount}</strong><span>evidencias</span></div></div>
    <div className="maintenance-category-review">{categories.map((item) => <div key={`${item.countField}-${item.typeId || item.key}`}><Icon name={item.icon} /><span>{item.label || item.key}</span><strong>{registered[item.key] || 0}/{form.counts[item.countField] || 0}</strong></div>)}</div>
    {!disabled && <div className="maintenance-final-actions"><button className="button button--secondary" type="button" onClick={onSave} disabled={saving}><Icon name="save" />Guardar pendiente</button>{canFinalize && <button className="button button--primary" type="button" onClick={onFinalize} disabled={saving}><Icon name="task_alt" />Finalizar mantenimiento</button>}</div>}
  </div>;
}
