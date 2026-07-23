import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import DependentSelect from '../forms/DependentSelect';
import InlineCreateModal from '../forms/InlineCreateModal';
import { MAINTENANCE_CATEGORIES, createEmptyChecklist } from '../../config/maintenanceCategories';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean, toOption } from '../../services/moduleApi';

function Field({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="4" {...props} /> : <input className="form-control" {...props} />}</label>;
}

function optionList(rows, valueKeys) {
  return rows.map((row) => toOption(row, valueKeys, ['Nombre'])).filter(Boolean);
}

function findById(rows, value, keys) {
  return rows.find((row) => keys.some((key) => String(row?.[key] || '') === String(value || '')));
}

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findByName(rows, value) {
  const expected = normalized(value);
  if (!expected) return undefined;
  return rows.find((row) => normalized(pick(row, ['Nombre'])) === expected);
}

function withCurrentOption(options, value, label, prefix) {
  const next = [...options];
  const currentValue = String(value || '');
  const currentLabel = String(label || '').trim();
  if (!currentValue && !currentLabel) return next;
  if (currentValue && next.some((option) => String(option.value) === currentValue)) return next;
  const equivalent = next.find((option) => normalized(option.label) === normalized(currentLabel));
  if (equivalent) return next;
  next.push({ value: currentValue || `legacy:${prefix}:${currentLabel}`, label: currentLabel || 'Valor anterior' });
  return next;
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

    const typeRow = findById(catalogs.deviceTypes, device.tipoDispositivoId, ['TipoDispositivoID', 'ID', 'id'])
      || findByName(catalogs.deviceTypes, device.categoria);
    const resolvedTypeId = String(pick(typeRow, ['TipoDispositivoID', 'ID', 'id']));
    if (resolvedTypeId && resolvedTypeId !== String(device.tipoDispositivoId || '')) values.tipoDispositivoId = resolvedTypeId;
    if (!device.categoria && typeRow) values.categoria = pick(typeRow, ['Nombre']);

    const manufacturerRow = findById(catalogs.manufacturers, device.fabricanteId, ['FabricanteID', 'ID', 'id'])
      || findByName(catalogs.manufacturers, device.fabricante);
    const resolvedManufacturerId = String(pick(manufacturerRow, ['FabricanteID', 'ID', 'id']));
    if (resolvedManufacturerId && resolvedManufacturerId !== String(device.fabricanteId || '')) values.fabricanteId = resolvedManufacturerId;
    if (!device.fabricante && manufacturerRow) values.fabricante = pick(manufacturerRow, ['Nombre']);

    const modelById = findById(catalogs.models, device.modeloId, ['ModeloID', 'ID', 'id']);
    const modelCandidates = catalogs.models.filter((item) => {
      const typeId = String(values.tipoDispositivoId || device.tipoDispositivoId || '');
      const manufacturerId = String(values.fabricanteId || device.fabricanteId || '');
      return (!typeId || String(pick(item, ['TipoDispositivoID'])) === typeId)
        && (!manufacturerId || String(pick(item, ['FabricanteID'])) === manufacturerId);
    });
    const modelRow = modelById || findByName(modelCandidates, device.modelo) || findByName(catalogs.models, device.modelo);
    const resolvedModelId = String(pick(modelRow, ['ModeloID', 'ID', 'id']));
    if (resolvedModelId && resolvedModelId !== String(device.modeloId || '')) values.modeloId = resolvedModelId;
    if (!device.modelo && modelRow) values.modelo = pick(modelRow, ['Nombre']);

    if (Object.keys(values).length) patch(values);
    // Se reconcilian únicamente identificadores faltantes o desactualizados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, catalogs.deviceTypes, catalogs.manufacturers, catalogs.models]);

  const typeOptions = useMemo(() => {
    const fromCatalog = optionList(catalogs.deviceTypes, ['TipoDispositivoID', 'ID', 'id']);
    const base = fromCatalog.length ? fromCatalog : MAINTENANCE_CATEGORIES.map((item) => ({ value: `legacy:${item.key}`, label: item.key }));
    return withCurrentOption(base, device.tipoDispositivoId, device.categoria, 'tipo');
  }, [catalogs.deviceTypes, device.categoria, device.tipoDispositivoId]);

  const relationManufacturerIds = useMemo(() => catalogs.relations
    .filter((item) => String(pick(item, ['TipoDispositivoID'])) === String(device.tipoDispositivoId) && toBoolean(pick(item, ['Activo'], true), true))
    .map((item) => String(pick(item, ['FabricanteID']))), [catalogs.relations, device.tipoDispositivoId]);

  const manufacturerRows = relationManufacturerIds.length
    ? catalogs.manufacturers.filter((item) => relationManufacturerIds.includes(String(pick(item, ['FabricanteID', 'ID', 'id']))))
    : catalogs.manufacturers;
  const manufacturerOptions = withCurrentOption(
    optionList(manufacturerRows, ['FabricanteID', 'ID', 'id']),
    device.fabricanteId,
    device.fabricante,
    'fabricante',
  );
  const modelRows = catalogs.models.filter((item) => (
    (!device.tipoDispositivoId || String(pick(item, ['TipoDispositivoID'])) === String(device.tipoDispositivoId))
    && (!device.fabricanteId || String(pick(item, ['FabricanteID'])) === String(device.fabricanteId))
  ));
  const modelOptions = withCurrentOption(
    optionList(modelRows, ['ModeloID', 'ID', 'id']),
    device.modeloId,
    device.modelo,
    'modelo',
  );

  function selectDeviceType(event) {
    const value = event.target.value;
    const row = findById(catalogs.deviceTypes, value, ['TipoDispositivoID', 'ID', 'id']);
    const selected = typeOptions.find((item) => item.value === value);
    const name = pick(row, ['Nombre'], selected?.label || value.replace(/^legacy:[^:]*:?/, ''));
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
    const selected = manufacturerOptions.find((item) => String(item.value) === String(value));
    patch({
      fabricanteId: row ? value : '',
      fabricante: pick(row, ['Nombre'], selected?.label || device.fabricante),
      modeloId: '',
      modelo: '',
    });
  }

  function selectModel(event) {
    const value = event.target.value;
    const row = findById(catalogs.models, value, ['ModeloID', 'ID', 'id']);
    const selected = modelOptions.find((item) => String(item.value) === String(value));
    patch({ modeloId: row ? value : '', modelo: pick(row, ['Nombre'], selected?.label || device.modelo) });
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
        const name = pick(result, ['Nombre'], values.nombre);
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

  return <>
    {error && <div className="alert alert--error"><span>{error}</span></div>}
    <DependentSelect label="Tipo de dispositivo *" value={device.tipoDispositivoId || (device.categoria ? `legacy:tipo:${device.categoria}` : '')} options={typeOptions} required loading={loading} canAdd={manageCatalogs} onAdd={() => openModal('device')} onChange={selectDeviceType} disabled={disabled} />
    <div className="ticket-form-grid">
      <DependentSelect label="Fabricante" value={device.fabricanteId || (device.fabricante ? `legacy:fabricante:${device.fabricante}` : '')} options={manufacturerOptions} loading={loading} disabled={disabled || (!device.tipoDispositivoId && !device.categoria)} canAdd={manageCatalogs && Boolean(device.tipoDispositivoId)} onAdd={() => openModal('manufacturer')} onChange={selectManufacturer} />
      <DependentSelect label="Modelo" value={device.modeloId || (device.modelo ? `legacy:modelo:${device.modelo}` : '')} options={modelOptions} loading={loading} disabled={disabled || (!device.tipoDispositivoId && !device.categoria) || (!device.fabricanteId && !device.fabricante)} canAdd={manageCatalogs && Boolean(device.fabricanteId)} onAdd={() => openModal('model')} onChange={selectModel} />
    </div>
    <InlineCreateModal open={Boolean(modal)} title={modal?.type === 'device' ? 'Agregar tipo de dispositivo' : modal?.type === 'manufacturer' ? 'Agregar fabricante' : 'Agregar modelo'} description="El registro quedará disponible tanto en boletas como en mantenimientos." saving={modalSaving} error={modalError} onClose={() => setModal(null)} onSubmit={submitModal}>{modal && <><Field label="Nombre" name="nombre" value={modal.values.nombre} onChange={modalUpdate} required />{['device', 'model'].includes(modal.type) && <Field label="Descripción" multiline name="descripcion" value={modal.values.descripcion} onChange={modalUpdate} />}{modal.type === 'model' && <Field label="Imagen de referencia (URL)" name="imagenReferenciaURL" value={modal.values.imagenReferenciaURL} onChange={modalUpdate} />}</>}</InlineCreateModal>
  </>;
}
