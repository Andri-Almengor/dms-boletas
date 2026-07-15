import React, { useState } from 'react';
import Icon from '../common/Icon';

export default function PasswordResetFeedback({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;

  const temporaryPassword = String(result.temporaryPassword || '');
  const sent = Boolean(result.email?.sent);

  async function copyPassword() {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copie la contraseña temporal:', temporaryPassword);
    }
  }

  return (
    <div className={`password-reset-feedback alert ${sent ? 'alert--success' : 'alert--warning'}`} role="status">
      <Icon name={sent ? 'mark_email_read' : 'warning'} />
      <div className="password-reset-feedback__content">
        <strong>{sent ? 'Contraseña restablecida' : 'Contraseña restablecida, correo pendiente'}</strong>
        <p>{result.message}</p>
        {temporaryPassword && (
          <div className="password-reset-feedback__temporary">
            <span>Contraseña temporal</span>
            <code>{temporaryPassword}</code>
            <button type="button" className="button button--secondary button--compact" onClick={copyPassword}>
              <Icon name={copied ? 'check' : 'content_copy'} /> {copied ? 'Copiada' : 'Copiar'}
            </button>
          </div>
        )}
        <small>El usuario deberá cambiar esta contraseña al iniciar sesión.</small>
      </div>
      {onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar aviso"><Icon name="close" /></button>}
    </div>
  );
}
