import React from 'react';
import '../../styles/offline.css';
import '../../styles/offline-compact-indicator.css';
import '../../styles/offline-sync-actions.css';
import OfflineDependencyRepairBridge from './OfflineDependencyRepairBridge';
import OfflineMaintenanceRouteBundle from './OfflineMaintenanceRouteBundle';
import OfflineSyncManager from './OfflineSyncManager';

export default function OfflineSyncRuntime() {
  return <>
    <OfflineMaintenanceRouteBundle />
    <OfflineDependencyRepairBridge />
    <OfflineSyncManager />
  </>;
}
