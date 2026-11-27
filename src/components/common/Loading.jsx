import React from 'react';

export default function Loading({ label = 'Cargando...', variant = 'list', className = '' }) {
  const page = variant === 'page';
  return (
    <div className={`dms-loading dms-loading--${variant} ${className}`.trim()} role="status" aria-live="polite">
      <span className="dms-loading__label">{label}</span>
      <div className="dms-loading__shapes" aria-hidden="true">
        {page && <div className="dms-loading__heading"><i /><i /></div>}
        {Array.from({ length: page ? 3 : 2 }, (_, index) => (
          <div className="dms-loading__card" key={index}>
            <div className="dms-loading__row"><i /><i /></div>
            <i /><i />
          </div>
        ))}
      </div>
    </div>
  );
}
