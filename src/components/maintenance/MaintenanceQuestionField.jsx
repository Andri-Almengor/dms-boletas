import React from 'react';
import { formatMacAddressInput, normalizeMacAddress } from '../../utils/macAddress';
import { projectQuestionConfig, projectQuestionRequired } from '../../features/maintenance/maintenanceProjectRelations';

function Choice({ value, onChange, options, disabled }) {
  return <div className="maintenance-choice">
    {options.map((option) => <button
      type="button"
      key={option}
      className={String(value ?? '') === String(option) ? 'is-selected' : ''}
      onClick={() => onChange(option)}
      disabled={disabled}
    >{option}</button>)}
  </div>;
}

export default function MaintenanceQuestionField({
  question,
  value,
  onChange,
  disabled = false,
  note = '',
}) {
  const type = String(question?.responseType || question?.TipoRespuesta || 'SI_NO').toUpperCase();
  const config = projectQuestionConfig(question);
  const required = projectQuestionRequired(question);
  const label = String(question?.label || question?.Pregunta || question?.key || '').trim();

  if (type === 'SI_NO') {
    return <div className="field-group maintenance-dynamic-question">
      <span className="field-label">{label}{required ? ' *' : ''}</span>
      {note && <small className="field-hint">{note}</small>}
      <Choice value={value} onChange={onChange} options={['Sí', 'No']} disabled={disabled} />
    </div>;
  }

  if (type === 'OPCIONES') {
    return <label className="field-group maintenance-dynamic-question">
      <span className="field-label">{label}{required ? ' *' : ''}</span>
      {note && <small className="field-hint">{note}</small>}
      <select
        className="form-control"
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
      >
        <option value="">Seleccione...</option>
        {(Array.isArray(config.options) ? config.options : []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>;
  }

  if (type === 'MAC') {
    return <label className="field-group maintenance-dynamic-question">
      <span className="field-label">{label}{required ? ' *' : ''}</span>
      {note && <small className="field-hint">{note}</small>}
      <input
        className="form-control"
        value={String(value ?? '')}
        onChange={(event) => onChange(formatMacAddressInput(event.target.value))}
        onBlur={() => onChange(normalizeMacAddress(value))}
        disabled={disabled}
        placeholder="AA:BB:CC:DD:EE:FF"
        autoComplete="off"
      />
    </label>;
  }

  const numeric = type === 'NUMERO' || type === 'CANTIDAD';
  return <label className="field-group maintenance-dynamic-question">
    <span className="field-label">{label}{required ? ' *' : ''}</span>
    {note && <small className="field-hint">{note}</small>}
    <input
      className="form-control"
      type={numeric ? 'number' : 'text'}
      min={type === 'CANTIDAD' ? '0' : undefined}
      step={numeric ? '1' : undefined}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      required={required}
      autoComplete="off"
    />
  </label>;
}
