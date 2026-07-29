import React, { memo } from 'react';

const OUTLINED_STYLE = Object.freeze({ fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" });
const FILLED_STYLE = Object.freeze({ fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" });

function Icon({ name, filled = false, className = '', title }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`.trim()}
      style={filled ? FILLED_STYLE : OUTLINED_STYLE}
      aria-hidden={title ? undefined : 'true'}
      title={title}
    >
      {name}
    </span>
  );
}

export default memo(Icon);
