import React from 'react';
import Icon from '../common/Icon';
import { MAINTENANCE_CATEGORIES } from '../../config/maintenanceCategories';

export default function MaintenanceCountsStep({ counts, registered, disabled, onChange }) {
  return <div className="maintenance-count-grid">{MAINTENANCE_CATEGORIES.map((item) => <label className="maintenance-count-card" key={item.key}><span><Icon name={item.icon} /><strong>{item.key}</strong></span><input type="number" min="0" value={counts[item.countField] || 0} onChange={(event) => onChange(item.countField, event.target.value)} disabled={disabled} /><small>{registered[item.key] || 0} registrados</small></label>)}</div>;
}
