import React from 'react';

export default function Icon({ name, filled = false, className = '', title }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`.trim()}
      style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
      aria-hidden={title ? undefined : 'true'}
      title={title}
    >
      {name}
    </span>
  );
}
