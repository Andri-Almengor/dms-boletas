import React from 'react';
import Icon from '../common/Icon';

const labels = {
  idle: 'Listo para guardar',
  saving: 'Guardando en segundo plano...',
  local: 'Guardado en este dispositivo',
  server: 'Sincronizado',
  restored: 'Borrador recuperado',
  error: 'Pendiente de reintento',
};

export default function AutosaveIndicator({ status = 'idle' }) {
  const icon = status === 'saving' ? 'sync' : status === 'error' ? 'cloud_off' : status === 'local' ? 'save' : 'cloud_done';
  return <span className={`autosave-indicator autosave-indicator--${status}`} role="status" aria-live="polite"><Icon name={icon} /> {labels[status] || labels.idle}</span>;
}
