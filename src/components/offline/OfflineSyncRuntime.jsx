import React from 'react';
import '../../styles/offline.css';
import '../../styles/offline-sync-actions.css';
import OfflineDependencyRepairBridge from './OfflineDependencyRepairBridge';
import OfflineSyncManager from './OfflineSyncManager';

export default function OfflineSyncRuntime() {
  return <>
    <OfflineDependencyRepairBridge />
    <OfflineSyncManager />
  </>;
}
