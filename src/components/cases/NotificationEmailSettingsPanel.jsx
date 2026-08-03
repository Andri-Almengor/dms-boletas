import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import {
  emailListText,
  getNotificationEmailSettings,
  parseEmailListText,
  saveNotificationEmailSettings,
} from '../../services/notificationEmailSettings';
import '../../styles/notification-email-settings.css';

const EMPTY = Object.freeze({
  caseCreatedTo: '',
  caseCreatedCc: '',
  caseAssignedCc: '',
  ticketDefaultCc: '',
  testRecipients: '',
  testCc: '',
});

const GROUPS = Object.freeze([
  {
    id: 'cases',
    icon: 'support_agent',
    title: 'Casos de clientes',
    note: 'Controla el correo inicial y las copias cuando se asignan técnicos.',
    fields: [
      {
        name: 'caseCreatedTo',
        label: 'Destinatarios principales del caso nuevo',
        required: true,
        help: 'Reciben el correo cuando un cliente crea un caso real.',
      },
      {
        name: 'caseCreatedCc',
        label: 'Copias del caso nuevo',
        help: 'Se agregan como CC al correo inicial de los casos reales.',
      },
      {
        name: 'caseAssignedCc',
        label: 'Copias al asignar técnicos',
        help: 'Los técnicos seleccionados continúan como destinatarios principales; estos correos reciben una copia.',
      },
    ],
  },
  {
    id: 'tickets',
    icon: 'description',
    title: 'Boletas',
    note: 'Estas copias se agregan a los correos reales de finalización y reportes firmados.',
    fields: [
      {
        name: 'ticketDefaultCc',
        label: 'Copias predeterminadas de boletas',
        help: 'Se combinan con las copias escritas directamente en cada boleta.',
      },
    ],
  },
  {
    id: 'tests',
    icon: 'science',
    title: 'Modo de prueba',
    note: 'Permite rotar la cuenta que recibe las pruebas sin modificar el código ni las variables del servidor.',
    fields: [
      {
        name: 'testRecipients',
        label: 'Destinatarios principales de prueba',
        required: true,
        help: 'Reciben casos de prueba y pruebas de correo de boletas. En asignaciones de prueba reciben una copia junto con los técnicos elegidos.',
      },
      {
        name: 'testCc',
        label: 'Copias de prueba',
        help: 'Se agregan a todos los correos enviados en modo de prueba.',
      },
    ],
  },
]);

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function Field({ definition, value, onChange }) {
  const emails = useMemo(() => parseEmailListText(value), [value]);
  const invalid = emails.filter((email) => !validEmail(email));
  return <label className={`notification-email-field${invalid.length ? ' has-error' : ''}`}>
    <span className="notification-email-field__label">
      <strong>{definition.label}{definition.required ? ' *' : ''}</strong>
      <small>{definition.help}</small>
    </span>
    <textarea
      value={value}
      onChange={(event) => onChange(definition.name, event.target.value)}
      rows="3"
      spellCheck="false"
      autoCapitalize="none"
      autoCorrect="off"
      placeholder="correo1@empresa.com&#10;correo2@empresa.com"
    />
    <span className="notification-email-field__footer">
      <small>Separe los correos con Enter, coma o punto y coma.</small>
      <b>{emails.length} correo{emails.length === 1 ? '' : 's'}</b>
    </span>
    {invalid.length > 0 && <span className="notification-email-field__error"><Icon name="error" />Revise: {invalid.join(', ')}</span>}
    {emails.length > 0 && !invalid.length && <span className="notification-email-chips">
      {emails.map((email) => <em key={email}><Icon name="mail" />{email}</em>)}
    </span>}
  </label>;
}

function toForm(settings = {}) {
  return Object.fromEntries(Object.keys(EMPTY).map((key) => [key, emailListText(settings[key])]));
}

function normalizedPayload(form) {
  return Object.fromEntries(Object.keys(EMPTY).map((key) => [key, parseEmailListText(form[key])]));
}

export default function NotificationEmailSettingsPanel({ open, onClose, sessionToken }) {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setMessage('');
    getNotificationEmailSettings(sessionToken, { signal: controller.signal })
      .then((settings) => { if (active) setForm(toForm(settings)); })
      .catch((loadError) => {
        if (active && loadError?.name !== 'AbortError') {
          setError(loadError.message || 'No se pudo cargar la configuración de correos.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, sessionToken]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event) => {
      if (event.key === 'Escape' && !saving) onClose?.();
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', escape);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  function change(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setError('');
    setMessage('');
  }

  async function save(event) {
    event.preventDefault();
    const payload = normalizedPayload(form);
    const invalid = Object.values(payload).flat().filter((email) => !validEmail(email));
    if (invalid.length) {
      setError(`Revise los correos inválidos: ${invalid.slice(0, 5).join(', ')}.`);
      return;
    }
    if (!payload.caseCreatedTo.length) {
      setError('Debe configurar al menos un destinatario principal para los casos nuevos.');
      return;
    }
    if (!payload.testRecipients.length) {
      setError('Debe configurar al menos un destinatario para las pruebas.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const settings = await saveNotificationEmailSettings(payload, sessionToken);
      setForm(toForm(settings));
      setMessage('Los destinatarios se actualizaron correctamente. Los próximos envíos usarán esta configuración.');
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar la configuración de correos.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="notification-email-settings-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !saving) onClose?.();
  }}>
    <section className="notification-email-settings-panel" role="dialog" aria-modal="true" aria-labelledby="notification-email-settings-title">
      <header>
        <div className="notification-email-settings-panel__heading">
          <span><Icon name="alternate_email" /></span>
          <div>
            <small>Administración</small>
            <h2 id="notification-email-settings-title">Destinatarios y copias</h2>
            <p>Cambie los correos sin modificar el código ni volver a desplegar el backend.</p>
          </div>
        </div>
        <button type="button" className="notification-email-settings-panel__close" onClick={onClose} disabled={saving} aria-label="Cerrar"><Icon name="close" /></button>
      </header>

      {loading ? <div className="notification-email-settings-state"><Icon name="progress_activity" /><strong>Cargando configuración...</strong><span>Consultando los valores guardados en la hoja Configuracion.</span></div>
        : <form onSubmit={save}>
          <div className="notification-email-settings-groups">
            {GROUPS.map((group) => <section key={group.id} className={`notification-email-settings-group is-${group.id}`}>
              <div className="notification-email-settings-group__heading"><span><Icon name={group.icon} /></span><div><h3>{group.title}</h3><p>{group.note}</p></div></div>
              <div className="notification-email-settings-group__fields">
                {group.fields.map((field) => <Field key={field.name} definition={field} value={form[field.name]} onChange={change} />)}
              </div>
            </section>)}
          </div>

          {error && <div className="notification-email-settings-alert is-error"><Icon name="error" /><span>{error}</span></div>}
          {message && <div className="notification-email-settings-alert is-success"><Icon name="check_circle" /><span>{message}</span></div>}

          <footer>
            <div><Icon name="info" /><span>Los cambios aplican a los envíos futuros. No reenvían correos anteriores automáticamente.</span></div>
            <button type="button" className="button button--secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="button button--primary" disabled={saving}>
              <Icon name={saving ? 'progress_activity' : 'save'} />{saving ? 'Guardando...' : 'Guardar correos'}
            </button>
          </footer>
        </form>}
    </section>
  </div>;
}
