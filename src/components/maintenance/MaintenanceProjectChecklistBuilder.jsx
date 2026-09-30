import React, { useMemo } from 'react';
import Icon from '../common/Icon';
import {
  PROJECT_CHECKLIST_RESPONSE_TYPES,
  createProjectChecklistQuestion,
  normalizeProjectChecklist,
  projectChecklistGroupForCategory,
  upsertProjectChecklistGroup,
} from '../../features/maintenance/maintenanceProjectChecklist';

function selectedCategories(categories = [], counts = {}) {
  return categories.filter((item) => Number(counts?.[item.countField] || 0) > 0);
}

export default function MaintenanceProjectChecklistBuilder({
  categories = [],
  counts = {},
  value,
  disabled = false,
  locked = false,
  onChange,
}) {
  const schema = useMemo(() => normalizeProjectChecklist(value), [value]);
  const selected = useMemo(() => selectedCategories(categories, counts), [categories, counts]);
  const readOnly = disabled || locked;

  function patchGroup(category, updater) {
    onChange?.(upsertProjectChecklistGroup(schema, category, updater));
  }

  function addQuestion(category) {
    patchGroup(category, (group) => ({
      ...group,
      questions: [
        ...(group.questions || []),
        createProjectChecklistQuestion(PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS),
      ],
    }));
  }

  function patchQuestion(category, questionId, patch) {
    patchGroup(category, (group) => ({
      ...group,
      questions: (group.questions || []).map((question) => (
        question.id === questionId ? { ...question, ...patch } : question
      )),
    }));
  }

  function removeQuestion(category, questionId) {
    patchGroup(category, (group) => ({
      ...group,
      questions: (group.questions || []).filter((question) => question.id !== questionId),
    }));
  }

  if (!selected.length) {
    return <div className="info-box"><Icon name="checklist" /><p>Seleccione al menos un tipo de dispositivo para configurar su checklist de progreso.</p></div>;
  }

  return <section className="maintenance-project-checklist-builder">
    <div className="maintenance-project-checklist-builder__heading">
      <div>
        <span className="eyebrow">Checklist personalizado</span>
        <h3>Progreso por tipo de dispositivo</h3>
        <p>Estas preguntas pertenecen únicamente a este Proyecto y se aplicarán a cada dispositivo del tipo correspondiente.</p>
      </div>
      <Icon name="checklist" />
    </div>

    {locked && <div className="alert alert--warning"><Icon name="lock" /><span>El checklist queda bloqueado cuando ya existen dispositivos para evitar reinterpretar avances registrados.</span></div>}

    <div className="maintenance-project-checklist-builder__groups">
      {selected.map((category) => {
        const group = projectChecklistGroupForCategory(schema, category) || { questions: [] };
        return <article className="maintenance-project-checklist-group" key={`${category.countField}-${category.typeId || category.key}`}>
          <header>
            <div><Icon name={category.icon || 'devices_other'} /><div><strong>{category.label || category.key}</strong><small>{group.questions.length} pregunta{group.questions.length === 1 ? '' : 's'} de progreso</small></div></div>
            {!readOnly && <button className="button button--secondary button--small" type="button" onClick={() => addQuestion(category)}><Icon name="add" />Agregar pregunta</button>}
          </header>

          {!group.questions.length
            ? <div className="maintenance-project-checklist-empty">Sin checklist personalizado para este tipo.</div>
            : <div className="maintenance-project-checklist-questions">
              {group.questions.map((question, index) => <div className="maintenance-project-checklist-question" key={question.id}>
                <span className="maintenance-project-checklist-question__number">{index + 1}</span>
                <label className="field-group">
                  <span className="field-label">Pregunta</span>
                  <input
                    className="form-control"
                    value={question.label}
                    placeholder="Ej. ¿Lector instalado?"
                    onChange={(event) => patchQuestion(category, question.id, { label: event.target.value })}
                    disabled={readOnly}
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">Respuesta</span>
                  <select
                    className="form-control"
                    value={question.responseType}
                    onChange={(event) => patchQuestion(category, question.id, { responseType: event.target.value })}
                    disabled={readOnly}
                  >
                    <option value={PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS}>Pendiente / Realizado</option>
                    <option value={PROJECT_CHECKLIST_RESPONSE_TYPES.YES_NO}>Sí / No</option>
                  </select>
                </label>
                {!readOnly && <button className="icon-button icon-button--danger" type="button" onClick={() => removeQuestion(category, question.id)} aria-label={`Eliminar ${question.label || 'pregunta'}`}><Icon name="delete" /></button>}
              </div>)}
            </div>}
        </article>;
      })}
    </div>
  </section>;
}
