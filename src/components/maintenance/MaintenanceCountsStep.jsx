import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { buildDynamicMaintenanceCategories } from '../../config/dynamicMaintenanceTypes';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../../services/moduleApi';

export default function MaintenanceCountsStep({ counts, registered, disabled, onChange }) {
  const { sessionToken } = useAuth();
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    requestAvailable(MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 1000, activo: true }, sessionToken)
      .then((data) => {
        if (active) setDeviceTypes(normalizeItems(data));
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'No se pudieron cargar los tipos de dispositivo. Se mostrarán los tipos históricos.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [sessionToken]);

  const categories = useMemo(
    () => buildDynamicMaintenanceCategories(deviceTypes, { counts, registered }),
    [deviceTypes, counts, registered],
  );

  return <div className="maintenance-counts-step">
    {loading && <div className="info-box"><Icon name="progress_activity" /><p>Actualizando los tipos de dispositivo del catálogo...</p></div>}
    {error && <div className="alert alert--warning"><Icon name="warning" /><span>{error}</span></div>}
    <div className="maintenance-count-grid">
      {categories.map((item) => <label className="maintenance-count-card" key={`${item.countField}-${item.typeId || item.key}`}>
        <span><Icon name={item.icon} /><strong>{item.label || item.key}</strong></span>
        <input
          type="number"
          min="0"
          value={counts[item.countField] || 0}
          onChange={(event) => onChange(item.countField, event.target.value)}
          disabled={disabled}
        />
        <small>{registered[item.key] || 0} registrados</small>
      </label>)}
    </div>
    {!loading && !categories.length && <div className="empty-state"><Icon name="devices_other" /><h3>Sin tipos de dispositivo activos</h3><p>Agregue tipos desde Catálogos para utilizarlos en los mantenimientos.</p></div>}
  </div>;
}
