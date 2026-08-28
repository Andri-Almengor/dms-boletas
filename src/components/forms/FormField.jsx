import { formatMacAddressInput } from '../../utils/macAddress';

function isMacField(name = '') {
  const normalized = String(name || '').replace(/[^a-z]/gi, '').toLowerCase();
  return ['mac', 'macaddress', 'direccionmac'].includes(normalized);
}

export default function FormField({ label, multiline = false, hint = '', rows = 5, className = '', ...props }) {
  const controlClassName = ['form-control', multiline ? 'ticket-textarea' : '', className]
    .filter(Boolean)
    .join(' ');
  const controlProps = !multiline && isMacField(props.name) && typeof props.onChange === 'function'
    ? {
      ...props,
      onChange: (event) => {
        event.target.value = formatMacAddressInput(event.target.value);
        props.onChange(event);
      },
    }
    : props;

  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea className={controlClassName} rows={rows} {...controlProps} />
        : <input className={controlClassName} {...controlProps} />}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}
