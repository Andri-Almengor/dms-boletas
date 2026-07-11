import React from 'react';
import Icon from '../common/Icon';

const labels = { idle: 'Sin cambios pendientes', saving: 'Guardando...', local: 'Guardado localmente', server: 'Guardado en servidor', restored: 'Borrador recuperado', error: 'Error al guardar' };

export default function AutosaveIndicator({ status = 'idle' }) {
  const icon = status === 'saving' ? 'sync' : status === 'error' ? 'error' : 'cloud_done';
  return <span className={`autosave-indicator autosave-indicator--${status}`}><Icon name={icon} /> {labels[status] || labels.idle}</span>;
}
