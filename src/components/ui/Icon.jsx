import React from 'react';
export default function Icon({ children, filled = false, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`} style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}>{children}</span>;
}