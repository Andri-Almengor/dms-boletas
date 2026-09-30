import React, { useMemo } from 'react';
import Icon from '../common/Icon';
import MaintenanceDeviceCatalogFields from './MaintenanceDeviceCatalogFields';
import MaintenanceQuestionField from './MaintenanceQuestionField';
import {
  normalizeProjectRelationValue,
  projectQuestionConfig,
  projectQuestionRequired,
  resizeProjectRelation,
  toggleProjectRelation,
  updateProjectRelationItem,
} from '../../features/maintenance/maintenanceProjectRelations';
import { pick } from '../../services/moduleApi';
import { formatMacAddressInput, macAddressError, normalizeMacAddress } from '../../utils/macAddress';

function clean(value) {
  return String(value ?? '').trim();
}

function typeNameById(catalogData, typeId) {
  const rows = catalogData?.catalogs?.deviceTypes || [];
  const row = rows.find((item) => String(pick(item, ['TipoDispositivoID', 'ID', 'id'])) === String(typeId || ''));
  return clean(pick(row, ['Nombre', 'nombre'], 'Dispositivo relacionado'));
}

function normalizedScalarQuestion(question = {}) {
  return {
    ...question,
    questionId: clean(question.questionId || question.id || question.PreguntaDispositivoID),
    typeId: clean(question.typeId || question.TipoDispositivoID),
    key: clean(question.key || question.Clave),
    label: clean(question.label || question.Pregunta || question.key),
    responseType: clean(question.responseType || question.TipoRespuesta || 'SI_NO').toUpperCase(),
  };
}

export default function MaintenanceProjectRelationField({
  question,
  value,
  onChange,
  disabled = false,
  catalogData,
  questionCatalog,
}) {
  const config = projectQuestionConfig(question);
  const relatedTypeId = clean(question.relatedTypeId || question.TipoDispositivoRelacionadoID);
  const relatedTypeName = typeNameById(catalogData, relatedTypeId);
  const fields = new Set(Array.isArray(config.fields) ? config.fields : []);
  const required = projectQuestionRequired(question);
  const relation = normalizeProjectRelationValue(value, { relatedTypeId, relatedTypeName });

  const childQuestionsByItem = useMemo(() => new Map(relation.items.map((item) => [
    item.localId,
    (questionCatalog?.forDevice?.(item, 'PROYECTO') || [])
      .map(normalizedScalarQuestion)
      .filter((entry) => entry.key && entry.responseType !== 'RELACION_DISPOSITIVO'),
  ])), [questionCatalog, relation.items]);

  function changeEnabled(enabled) {
    onChange(toggleProjectRelation(relation, enabled, { relatedTypeId, relatedTypeName }));
  }

  function changeQuantity(next) {
    onChange(resizeProjectRelation(relation, next, { relatedTypeId, relatedTypeName }));
  }

  function patchItem(localId, patch) {
    onChange(updateProjectRelationItem(relation, localId, patch, { relatedTypeId, relatedTypeName }));
  }

  function updateItemQuestion(item, childQuestion, nextValue) {
    const details = [...(item.questionDetails || [])];
    const index = details.findIndex((entry) => clean(entry.key || entry.Clave) === childQuestion.key);
    const nextDetail = {
      questionId: childQuestion.questionId,
      typeId: childQuestion.typeId || relatedTypeId,
      key: childQuestion.key,
      label: childQuestion.label,
      order: Number(childQuestion.order || 0),
      responseType: childQuestion.responseType,
      appliesTo: childQuestion.appliesTo || 'PROYECTO',
      relatedTypeId: childQuestion.relatedTypeId || '',
      config: childQuestion.config || {},
      value: nextValue,
      activeAtSave: true,
    };
    if (index >= 0) details[index] = { ...details[index], ...nextDetail };
    else details.push(nextDetail);
    patchItem(item.localId, {
      respuestas: { ...(item.respuestas || {}), [childQuestion.key]: nextValue },
      questionDetails: details,
    });
  }

  return <section className="maintenance-project-relation">
    <div className="maintenance-project-relation__heading">
      <div>
        <span className="field-label">{question.label}{required ? ' *' : ''}</span>
        <small>{relatedTypeName}{required ? ' · relación obligatoria' : ' · relación opcional'}</small>
      </div>
      <div className="maintenance-choice maintenance-project-relation__toggle" aria-label={question.label}>
        {[
          ['Sí', true],
          ['No', false],
        ].map(([label, enabled]) => <button
          type="button"
          key={label}
          className={relation.enabled === enabled ? 'is-selected' : ''}
          onClick={() => changeEnabled(enabled)}
          disabled={disabled}
        >{label}</button>)}
      </div>
    </div>

    {relation.enabled && <>
      {fields.has('cantidad') && <label className="field-group maintenance-project-relation__quantity">
        <span className="field-label">Cantidad de {relatedTypeName.toLowerCase()}</span>
        <input
          className="form-control"
          type="number"
          min="1"
          max="100"
          value={relation.quantity || 1}
          onChange={(event) => changeQuantity(event.target.value)}
          disabled={disabled}
        />
      </label>}

      <div className="maintenance-project-relation__items">
        {relation.items.map((item, index) => {
          const invalidMac = fields.has('mac') ? macAddressError(item.macAddress) : '';
          const childQuestions = childQuestionsByItem.get(item.localId) || [];
          return <article className="maintenance-project-component" key={item.localId}>
            <header>
              <span className="maintenance-project-component__icon"><Icon name="extension" /></span>
              <div><strong>{relatedTypeName} {index + 1}</strong><small>Componente ligado a {question.label}</small></div>
            </header>

            <MaintenanceDeviceCatalogFields
              device={item}
              onChange={(next) => patchItem(item.localId, next)}
              disabled={disabled}
              catalogData={catalogData}
              fixedTypeId={relatedTypeId}
              fixedTypeName={relatedTypeName}
              hideType
              showManufacturer={fields.has('fabricante') || fields.has('modelo')}
              showModel={fields.has('modelo')}
            />

            <div className="ticket-form-grid">
              {fields.has('nombre') && <label className="field-group"><span className="field-label">Nombre / identificador</span><input className="form-control" value={item.nombre || ''} onChange={(event) => patchItem(item.localId, { nombre: event.target.value })} disabled={disabled} /></label>}
              {fields.has('serie') && <label className="field-group"><span className="field-label">Serie</span><input className="form-control" value={item.serie || ''} onChange={(event) => patchItem(item.localId, { serie: event.target.value })} disabled={disabled} /></label>}
              {fields.has('mac') && <label className="field-group"><span className="field-label">Dirección MAC</span><input className="form-control" value={item.macAddress || ''} onChange={(event) => patchItem(item.localId, { macAddress: formatMacAddressInput(event.target.value) })} onBlur={() => patchItem(item.localId, { macAddress: normalizeMacAddress(item.macAddress) })} disabled={disabled} placeholder="AA:BB:CC:DD:EE:FF" /></label>}
            </div>
            {invalidMac && <div className="alert alert--error"><Icon name="error" /><span>{invalidMac}</span></div>}

            {childQuestions.length > 0 && <div className="maintenance-project-component__questions">
              {childQuestions.map((childQuestion) => <MaintenanceQuestionField
                key={childQuestion.questionId || childQuestion.key}
                question={childQuestion}
                value={item.respuestas?.[childQuestion.key] ?? childQuestion.value ?? ''}
                onChange={(nextValue) => updateItemQuestion(item, childQuestion, nextValue)}
                disabled={disabled}
              />)}
            </div>}
          </article>;
        })}
      </div>
    </>}
  </section>;
}
