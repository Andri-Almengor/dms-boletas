import React, { useMemo } from 'react';
import Icon from '../common/Icon';
import { buildDynamicMaintenanceCategories } from '../../config/dynamicMaintenanceTypes';
import {
  countMaintenanceEvidence,
  countRegisteredMaintenanceDevices,
  expectedMaintenanceTotal,
} from '../../features/maintenance/maintenanceFormDomain';

export default function MaintenanceDeviceProgressSummary({
  counts = {},
  devices = [],
  registered = null,
  deviceTypes = [],
  expectedTotal,
  projectMode = false,
  projectProgress = null,
  className = '',
}) {
  const resolvedRegistered = useMemo(
    () => registered || countRegisteredMaintenanceDevices(devices),
    [devices, registered],
  );
  const resolvedExpectedTotal = useMemo(() => {
    const supplied = Number(expectedTotal);
    return Number.isFinite(supplied)
      ? supplied
      : expectedMaintenanceTotal(counts, devices);
  }, [counts, devices, expectedTotal]);
  const evidenceCount = useMemo(
    () => countMaintenanceEvidence(devices),
    [devices],
  );
  const categories = useMemo(
    () => buildDynamicMaintenanceCategories(deviceTypes, {
      counts,
      registered: resolvedRegistered,
    }).filter((item) => (
      Number(counts[item.countField] || 0) > 0
      || Number(resolvedRegistered[item.key] || 0) > 0
    )),
    [counts, deviceTypes, resolvedRegistered],
  );

  return (
    <div className={`maintenance-device-progress-summary${className ? ` ${className}` : ''}`}>
      <div className="maintenance-review__stats">
        <div><strong>{resolvedExpectedTotal}</strong><span>esperados</span></div>
        <div><strong>{devices.length}</strong><span>registrados</span></div>
        <div><strong>{evidenceCount}</strong><span>evidencias</span></div>
        {projectMode && projectProgress && (
          <div><strong>{projectProgress.percent}%</strong><span>progreso checklist</span></div>
        )}
      </div>
      <div className="maintenance-category-review">
        {categories.map((item) => (
          <div key={`${item.countField}-${item.typeId || item.key}`}>
            <Icon name={item.icon} />
            <span>{item.label || item.key}</span>
            <strong>
              {resolvedRegistered[item.key] || 0}/{counts[item.countField] || 0}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
