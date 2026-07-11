import React, { useState } from 'react';
import Icon from './Icon';

export default function PasswordInput({ id, label, value, onChange, autoComplete, minLength, required = true, placeholder = '••••••••' }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="input-shell">
        <Icon name="lock" className="input-shell__leading" />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="form-control form-control--with-icons"
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="icon-button input-shell__trailing"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          <Icon name={visible ? 'visibility_off' : 'visibility'} />
        </button>
      </div>
    </div>
  );
}
