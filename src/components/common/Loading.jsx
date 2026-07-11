import React from 'react';
import Icon from './Icon';

export default function Loading({ label = 'Cargando...' }) {
  return (
    <div className="state-card state-card--loading" role="status" aria-live="polite">
      <Icon name="progress_activity" className="spin" />
      <span>{label}</span>
    </div>
  );
}
