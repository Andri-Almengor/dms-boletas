import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import DependentSelect from '../forms/DependentSelect';
import InlineCreateModal from '../forms/InlineCreateModal';
import {
  MAINTENANCE_CATEGORIES,
  canonicalMaintenanceCategoryName,
  createEmptyChecklist,
} from '../../config/maintenanceCategories';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean, toOption } from '../../services/moduleApi';

function Field({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="4" {...props} /> : <input className="form-control" {...props} />}</label>;
}

function normalized(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function optionList(rows, valueKeys) {
  return rows.map((row) => toOption(row, valueKeys, ['Nombre'])).filter(Boolean);
}

function findById(rows, value, keys) {
  return rows.find((row) => keys.some((key) => String(row?.[key] || '') === String(value || '')));
}

function addCurrentOption(options, value, label) {
  const cleanLabel = String(label || '').trim();
  const cleanValue = String(value || '').trim();
  if (!cleanLabel) return options;
  if (cleanValue && options.some((item) => String(item.value) === cleanValue)) return options;
  if (!cleanValue && options.some((item) => normalized(item.label) === normalized(cleanLabel))) return options;
  return [...options, { value: cleanValue || `legacy:${cleanLabel}`, label: cleanLabel }];
}

function uniqueOptions(options, canonicalLabels = false) {
  const seenValues = new Set();
  const seenLabels = new Set();
  return options.filter((option) => {
    const valueKey = String(option.value || '');
    const labelKey = normalized(canonicalLabels ? canonicalMaintenanceCategoryName(option.label) : option.label);
    if (seenValues.has(valueKey) || seenLabels.has(labelKey)) return false;
    seenValues.add(valueKey);
    seenLabels.add(labelKey);
    return true;
  });
}

export default function MaintenanceDeviceCatalogFields({ device, onChange, disabled = false }) {
  const { sessionToken, hasPermission } = useAuth();
  const manageCatalogs = hasPermission('CATALOGOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('BOLETAS_CREAR')
    || hasPermission('BOLETAS_EDITAR');
  const [catalogs, setCatalogs] = useState({ deviceTypes: [], manufacturers: [], models: [], relations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  function patch(values) { onChange({ ...device, ...values }); }

  async function loadCatalogs() {
    setLoading(true);
    setError('');
    const jobs = [
      ['deviceTypes', MODULE_ROUTES.deviceTypes.list],
      ['manufacturers', MODULE_ROUTES.manufacturers.list],
      ['models', MODULE_ROUTES.models.list],
      ['relations', MODULE_ROUTES.deviceManufacturers.list],
    ];
    const results = await Promise.allSettled(jobs.map(([, routes]) => requestAvailable(routes, { page: 1, pageSize: 1000, activo: true }, sessionToken)));
    const next = {};
    const failures = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[jobs[index][0]] = normalizeItems(result.value);
      else failures.push(result.reason?.message);
    });
    setCatalogs((current) => ({ ...current, ...next }));
    if (failures.length) setError(`Algunos catálogos no se cargaron: ${failures.filter(Boolean).join(' · ')}`);
    setLoading(false);
  }

  useEffect(() => {
    loadCatalogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  useEffect(() => {
    if (loading) return;
    const values = {};
    const canonicalCategory = canonicalMaintenanceCategoryName(device.categoria);
    const typeById = findById(catalogs.deviceTypes, device.tipoDispositivoId, ['TipoDispositivoID', 'ID', 'id']);
    const typeByName = catalogs.deviceTypes.find((item) => (
      canonicalMaintenanceCategoryName(pick(item, ['Nombre'])) === canonicalCategory
      || normalized(pick(item, ['Nombre'])) === normalized(device.categoria)
    ));
    const resolvedType = typeById || typeByName;
    if (resolvedType) {
      const resolvedId = String(pick(resolvedType, ['TipoDispositivoID', 'ID', 'id']));
      const resolvedName = canonicalMaintenanceCategoryName(pick(resolvedType, ['Nombre'], canonicalCategory));
      if (!device.tipoDispositivoId && resolvedId) values.tipoDispositivoId = resolvedId;
      if (device.categoria !== resolvedName) values.categoria = resolvedName;
    } else if (device.categoria !== canonicalCategory) {
      values.categoria = canonicalCategory;
    }

    const manufacturerById = findById(catalogs.manufacturers, device.fabricanteId, ['FabricanteID', 'ID', 'id']);
    const manufacturerByName = catalogs.manufacturers.find((item) => normalized(pick(item, ['Nombre'])) === normalized(device.fabricante));
    const resolvedManufacturer = manufacturerById || manufacturerByName;
    if (resolvedManufacturer) {
      const resolvedId = String(pick(resolvedManufacturer, ['FabricanteID', 'ID', 'id']));
      const resolvedName = pick(resolvedManufacturer, ['Nombre']);
      if (!device.fabricanteId && resolvedId) values.fabricanteId = resolvedId;
      if (!device.fabricante && resolvedName) values.fabricante = resolvedName;
    }

    const modelById = findById(catalogs.models, device.modeloId, ['ModeloID', 'ID', 'id']);
    const modelByName = catalogs.models.find((item) => normalized(pick(item, ['Nombre'])) === normalized(device.modelo));
    const resolvedModel = modelById || modelByName;
    if (resolvedModel) {
      const resolvedId = String(pick(resolvedModel, ['ModeloID', 'ID', 'id']));
      const resolvedName = pick(resolvedModel, ['Nombre']);
      if (!device.modeloId && resolvedId) values.modeloId = resolvedId;
      if (!device.modelo && resolvedName) values.modelo = resolvedName;
    }

    if (Object.keys(values).length) patch(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const typeOptions = useMemo(() => {
    const fromCatalog = optionList(catalogs.deviceTypes, ['TipoDispositivoID', 'ID', 'id'])
      .map((item) => ({ ...item, label: canonicalMaintenanceCategoryName(item.label) }));
    const base = fromCatalog.length
      ? fromCatalog
      : MAINTENANCE_CATEGORIES.map((item) => ({ value: `legacy:${item.key}`, label: item.key }));
    return uniqueOptions(addCurrentOption(base, device.tipoDispositivoId, canonicalMaintenanceCategoryName(device.categoria)), true);
  }, [catalogs.deviceTypes, device.categoria, device.tipoDispositivoId]);

  const relationManufacturerIds = useMemo(() => catalogs.relations
    .filter((item) => String(pick(item, ['TipoDispositivoID'])) === String(device.tipoDispositivoId) && toBoolean(pick(item, ['Activo'], true), true))
    .map((item) => String(pick(item, ['FabricanteID']))), [catalogs.relations, device.tipoDispositivoId]);

  const manufacturerRows = relationManufacturerIds.length
    ? catalogs.manufacturers.filter((item) => relationManufacturerIds.includes(String(pick(item, ['FabricanteID', 'ID', 'id']))))
    : catalogs.manufacturers;
  const manufacturerOptions = uniqueOptions(addCurrentOption(
    optionList(manufacturerRows, ['FabricanteID', 'ID', 'id']),
    device.fabricanteId,
    device.fabricante,
  ));

  const modelRows = catalogs.models.filter((item) => (
    (!device.tipoDispositivoId || String(pick(item, ['TipoDispositivoID'])) === String(device.tipoDispositivoId))
    && (!device.fabricanteId || String(pick(item, ['FabricanteID'])) === String(device.fabricanteId))
  ));
  const modelOptions = uniqueOptions(addCurrentOption(
    optionList(modelRows, ['ModeloID', 'ID', 'id']),
    device.modeloId,
    device.modelo,
  ));

  function selectDeviceType(event) {
    const value = event.target.value;
    const row = findById(catalogs.deviceTypes, value, ['TipoDispositivoID', 'ID', 'id']);
    const selected = typeOptions.find((item) => item.value === value);
    const name = canonicalMaintenanceCategoryName(pick(row, ['Nombre'], selected?.label || value.replace(/^legacy:/, '')));
    const hasAnswers = Object.values(device.respuestas || {}).some(Boolean);
    if (name !== device.categoria && hasAnswers && !window.confirm('Al cambiar el tipo de dispositivo se reiniciará el checklist actual. ¿Desea continuar?')) return;
    patch({
      tipoDispositivoId: row ? String(pick(row, ['TipoDispositivoID', 'ID', 'id'])) : '',
      categoria: name,
      fabricanteId: '', fabricante: '', modeloId: '', modelo: '',
      respuestas: createEmptyChecklist(name),
    });
  }

  function selectManufacturer(event) {
    const value = event.target.value;
    const row = findById(catalogs.manufacturers, value, ['FabricanteID', 'ID', 'id']);
    patch({ fabricanteId: value, fabricante: pick(row, ['Nombre'], device.fabricante), modeloId: '', modelo: '' });
  }

  function selectModel(event) {
    const value = event.target.value;
    const row = findById(catalogs.models, value, ['ModeloID', 'ID', 'id']);
    patch({ modeloId: value, modelo: pick(row, ['Nombre'], device.modelo) });
  }

  function openModal(type) {
    setModal({ type, values: { nombre: '', descripcion: '', imagenReferenciaURL: '' } });
    setModalError('');
  }

  function modalUpdate(event) {
    setModal((current) => ({ ...current, values: { ...current.values, [event.target.name]: event.target.value } }));
  }

  async function submitModal(event) {
    event.preventDefault();
    const { type, values } = modal;
    if (!values.nombre.trim()) return setModalError('El nombre es obligatorio.');
    if (type === 'manufacturer' && !device.tipoDispositivoId) return setModalError('Seleccione primero el tipo de dispositivo.');
    if (type === 'model' && (!device.tipoDispositivoId || !device.fabricanteId)) return setModalError('Seleccione primero el tipo de dispositivo y el fabricante.');
    setModalSaving(true);
    setModalError('');
    try {
      let result;
      if (type === 'device') {
        result = await requestAvailable(MODULE_ROUTES.deviceTypes.create, { nombre: values.nombre, descripcion: values.descripcion, activo: true }, sessionToken);
        const name = canonicalMaintenanceCategoryName(pick(result, ['Nombre'], values.nombre));
        patch({ tipoDispositivoId: String(pick(result, ['TipoDispositivoID', 'ID', 'id'])), categoria: name, fabricanteId: '', fabricante: '', modeloId: '', modelo: '', respuestas: createEmptyChecklist(name) });
      }
      if (type === 'manufacturer') {
        result = await requestAvailable(MODULE_ROUTES.manufacturers.create, { nombre: values.nombre, activo: true }, sessionToken);
        const id = String(pick(result, ['FabricanteID', 'ID', 'id']));
        await requestAvailable(MODULE_ROUTES.deviceManufacturers.create, { tipoDispositivoId: device.tipoDispositivoId, fabricanteId: id, activo: true }, sessionToken);
        patch({ fabricanteId: id, fabricante: pick(result, ['Nombre'], values.nombre), modeloId: '', modelo: '' });
      }
      if (type === 'model') {
        result = await requestAvailable(MODULE_ROUTES.models.create, { tipoDispositivoId: device.tipoDispositivoId, fabricanteId: device.fabricanteId, nombre: values.nombre, descripcion: values.descripcion, imagenReferenciaURL: values.imagenReferenciaURL, activo: true }, sessionToken);
        patch({ modeloId: String(pick(result, ['ModeloID', 'ID', 'id'])), modelo: pick(result, ['Nombre'], values.nombre) });
      }
      await loadCatalogs();
      setModal(null);
    } catch (saveError) {
      setModalError(saveError.message);
    } finally {
      setModalSaving(false);
    }
  }

  const selectedTypeValue = device.tipoDispositivoId || (device.categoria ? `legacy:${canonicalMaintenanceCategoryName(device.categoria)}` : '');

  return <>
    {error && <div className="alert alert--error"><span>{error}</span></div>}
    <DependentSelect label="Tipo de dispositivo *" value={selectedTypeValue} options={typeOptions} required loading={loading} canAdd={manageCatalogs} onAdd={() => openModal('device')} onChange={selectDeviceType} disabled={disabled} />
    <div className="ticket-form-grid">
      <DependentSelect label="Fabricante" value={device.fabricanteId} options={manufacturerOptions} loading={loading} disabled={disabled || !selectedTypeValue} canAdd={manageCatalogs && Boolean(selectedTypeValue)} onAdd={() => openModal('manufacturer')} onChange={selectManufacturer} />
      <DependentSelect label="Modelo" value={device.modeloId} options={modelOptions} loading={loading} disabled={disabled || !selectedTypeValue || !device.fabricanteId} canAdd={manageCatalogs && Boolean(device.fabricanteId)} onAdd={() => openModal('model')} onChange={selectModel} />
    </div>
    <InlineCreateModal open={Boolean(modal)} title={modal?.type === 'device' ? 'Agregar tipo de dispositivo' : modal?.type === 'manufacturer' ? 'Agregar fabricante' : 'Agregar modelo'} description="El registro quedará disponible tanto en boletas como en mantenimientos." saving={modalSaving} error={modalError} onClose={() => setModal(null)} onSubmit={submitModal}>{modal && <><Field label="Nombre" name="nombre" value={modal.values.nombre} onChange={modalUpdate} required />{['device', 'model'].includes(modal.type) && <Field label="Descripción" multiline name="descripcion" value={modal.values.descripcion} onChange={modalUpdate} />}{modal.type === 'model' && <Field label="Imagen de referencia (URL)" name="imagenReferenciaURL" value={modal.values.imagenReferenciaURL} onChange={modalUpdate} />}</>}</InlineCreateModal>
  </>;
}
