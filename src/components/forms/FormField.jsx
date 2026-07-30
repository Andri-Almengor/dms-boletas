export default function FormField({ label, multiline = false, hint = '', rows = 5, className = '', ...props }) {
  const controlClassName = ['form-control', multiline ? 'ticket-textarea' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea className={controlClassName} rows={rows} {...props} />
        : <input className={controlClassName} {...props} />}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}
