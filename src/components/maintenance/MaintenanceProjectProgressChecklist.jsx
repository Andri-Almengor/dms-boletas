import React, { useMemo } from 'react';
import Icon from '../common/Icon';
import {
  PROJECT_CHECKLIST_RESPONSE_TYPES,
  projectChecklistProgressForDevice,
  setProjectProgressAnswer,
} from '../../features/maintenance/maintenanceProjectChecklist';

function optionLabel(value) {
  if (value === 'SI') return 'Sí';
  if (value === 'NO') return 'No';
  if (value === 'REALIZADO') return 'Realizado';
  return 'Pendiente';
}

export default function MaintenanceProjectProgressChecklist({
  checklist,
  device,
  disabled = false,
  onChange,
  compact = false,
}) {
  const stats = useMemo(
    () => projectChecklistProgressForDevice(checklist, device),
    [checklist, device],
  );

  if (!stats.group || !stats.total) {
    return compact ? null : <div className="info-box"><Icon name="checklist" /><p>Este tipo de dispositivo no tiene checklist de progreso configurado para el Proyecto.</p></div>;
  }

  function setAnswer(question, value, note) {
    onChange?.(setProjectProgressAnswer(
      device.projectProgress || device.ProyectoProgresoJSON,
      question,
      value,
      note,
    ));
  }

  if (compact) {
    return <div className="maintenance-project-progress-summary">
      <span><Icon name={stats.complete ? 'task_alt' : 'pending_actions'} />Progreso</span>
      <strong>{stats.completed}/{stats.total} · {stats.percent}%</strong>
    </div>;
  }

  return <section className="maintenance-project-progress">
    <header className="maintenance-project-progress__heading">
      <div><span className="eyebrow">Progreso del proyecto</span><h3>{stats.group.typeName || 'Checklist del dispositivo'}</h3></div>
      <strong>{stats.percent}%</strong>
    </header>
    <div className="maintenance-project-progress__track"><span style={{ width: `${stats.percent}%` }} /></div>

    <div className="maintenance-project-progress__questions">
      {stats.items.map((question) => {
        const options = question.responseType === PROJECT_CHECKLIST_RESPONSE_TYPES.YES_NO
          ? ['SI', 'NO']
          : ['PENDIENTE', 'REALIZADO'];
        return <article className={`maintenance-project-progress__question ${question.completed ? 'is-complete' : 'is-pending'}`} key={question.id}>
          <div className="maintenance-project-progress__question-title"><Icon name={question.completed ? 'check_circle' : 'schedule'} /><strong>{question.label}</strong></div>
          <div className="maintenance-choice">
            {options.map((option) => <button
              type="button"
              key={option}
              className={question.value === option ? 'is-selected' : ''}
              onClick={() => setAnswer(question, option, question.note)}
              disabled={disabled}
            >{optionLabel(option)}</button>)}
          </div>
          {question.responseType === PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS && question.value === 'PENDIENTE' && <label className="field-group">
            <span className="field-label">Nota del pendiente</span>
            <textarea
              className="form-control ticket-textarea"
              rows="3"
              placeholder="Explique por qué continúa pendiente (opcional)."
              value={question.note || ''}
              onChange={(event) => setAnswer(question, 'PENDIENTE', event.target.value)}
              disabled={disabled}
            />
          </label>}
        </article>;
      })}
    </div>
  </section>;
}
