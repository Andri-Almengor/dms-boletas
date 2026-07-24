import React, { createContext, useContext } from 'react';

const MaintenanceCountsContext = createContext(null);

export function MaintenanceCountsProvider({ counts, children }) {
  return <MaintenanceCountsContext.Provider value={counts || {}}>{children}</MaintenanceCountsContext.Provider>;
}

export function useMaintenanceCounts() {
  return useContext(MaintenanceCountsContext);
}
