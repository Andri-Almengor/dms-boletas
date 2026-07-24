import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import MaintenanceDeviceEditor from '../../components/maintenance/MaintenanceDeviceEditor';
import MaintenanceGeneralStep from '../../components/maintenance/MaintenanceGeneralStep';
import MaintenanceCountsStep from '../../components/maintenance/MaintenanceCountsStep';
import MaintenanceDevicesStep from '../../components/maintenance/MaintenanceDevicesStep';
import MaintenanceReviewStep from '../../components/maintenance/MaintenanceReviewStep';
import useMaintenanceForm from '../../hooks/useMaintenanceForm';
import { MAINTENANCE_STEPS } from './maintenanceFormData';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

function Field({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="4" {...props} /> : <input className="form-control" {...props} />}</label>;
}

export default function MaintenanceFormPage({ mode = 'create' }) {
  const { maintenanceId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const editing = mode === 'edit';
  const isAdministrator = hasPermission('USUARIOS_GESTIONAR');
  const directDeviceMode = editing && searchParams.get('directDevice') === '1';
  const requestedNewDevice = directDeviceMode && searchParams.get('newDevice') === '1';
  const requestedStep = searchParams.get('step') === 'devices' || directDeviceMode ? 2 : 0;
  const requestedDeviceId = String(searchParams.get('device') || '');
  const requestedDeviceOpenedRef = useRef('');
  const state = useMaintenanceForm({ editing, maintenanceId });
  const [step, setStep] = useState(requestedStep);
  const [modal, setModal] = useState(null);
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);
  const detailUrl = `/mantenimientos/${encodeURIComponent(maintenanceId)}`;

  useEffect(() => {
    if (searchParams.get('step') === 'devices' || directDeviceMode) setStep(2);
  }, [searchParams, directDeviceMode]);

  useEffect(() => {
    if (!editing || state.loading || !requestedNewDevice || state.activeDevice) return;
    if (requestedDeviceOpenedRef.current === '__new__') return;
    requestedDeviceOpenedRef.current = '__new__';
    state.openDevice(state.createDevice());
    // Las funciones del hook cambian por render; la referencia evita abrir dos veces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, requestedNewDevice, state.loading, state.activeDevice]);

  useEffect(() => {
    if (!editing || state.loading || requestedNewDevice || !requestedDeviceId || state.activeDevice) return;
    if (requestedDeviceOpenedRef.current === requestedDeviceId) return;
    if (!state.devices.length) return;

    const selected = state.devices.find((device) => String(device.id || device.localId) === requestedDeviceId);
    if (!selected) {
      requestedDeviceOpenedRef.current = requestedDeviceId;
      state.setError('No se encontró el dispositivo solicitado. Puede seleccionarlo desde la lista.');
      setStep(2);
      return;
    }

    requestedDeviceOpenedRef.current = requestedDeviceId;
    state.openDevice(selected);
    // state.openDevice cambia en cada render; la apertura se controla con la referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, requestedDeviceId, requestedNewDevice, state.loading, state.devices, state.activeDevice]);

  if (!state.allowed) return <Navigate to="/mantenimientos" replace />;
  if (state.loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimiento...</div></div>;

  async function saveDevice() {
    const saved = await state.closeActiveDevice();
    if (saved && directDeviceMode) navigate(detailUrl, { replace: true });
    return saved;
  }

  function cancelDevice() {
    const cancelled = state.cancelActiveDevice();
    if (cancelled && directDeviceMode) navigate(detailUrl, { replace: true });
    return cancelled;
  }

  async function deleteDevice() {
    await state.removeDevice(state.activeDevice);
    if (directDeviceMode) navigate(detailUrl, { replace: true });
  }

  if (state.activeDevice) {
    return <div className="page page--narrow maintenance-form-page maintenance-device-form-page">
      <MaintenanceDeviceEditor
        device={state.activeDevice}
        equipmentOptions={state.equipment.map((item) => ({ value: item.id, label: item.name }))}
        maintenanceLocationId={state.form.ubicacionId}
        technicians={state.technicians}
        disabled={state.readOnly || state.saving}
        isAdmin={state.isAdmin}
        onChange={state.setActiveDevice}
        onCancel={cancelDevice}
        onClose={cancelDevice}
        onSubmit={saveDevice}
        onSubmitAndContinue={!directDeviceMode && !state.activeDevice.id ? state.saveAndAddAnotherDevice : undefined}
        onDelete={deleteDevice}
        submitting={state.deviceSaving}
        autosaveStatus={state.deviceAutosaveStatus}
      />
    </div>;
  }

  if (directDeviceMode) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Abriendo formulario del dispositivo...</div></div>;
  }

  function openModal(type) {
    setModal({ type, values: { nombre: '', direccion: '', descripcion: '' } });
    setModalError('');
  }

  async function submitModal(event) {
    event.preventDefault();
    if (!modal.values.nombre.trim()) {
      setModalError('El nombre es obligatorio.');
      return;
    }
    setModalSaving(true);
    setModalError('');
    try {
      if (modal.type === 'location') {
        const result = await requestAvailable(MODULE_ROUTES.clients.locationsCreate, {
          clienteId: state.form.clienteId,
          nombre: modal.values.nombre,
          direccion: modal.values.direccion,
          activo: true,
        }, state.sessionToken);
        const view = { id: String(pick(result, ['UbicacionID', 'id'])), name: pick(result, ['Nombre'], modal.values.nombre) };
        state.locations.push(view);
        state.setForm((current) => ({ ...current, ubicacionId: view.id, ubicacion: view.name }));
      } else {
        const result = await requestAvailable(MODULE_ROUTES.clients.equipmentLocationsCreate, {
          ubicacionId: state.form.ubicacionId,
          nombre: modal.values.nombre,
          descripcion: modal.values.descripcion,
          activo: true,
        }, state.sessionToken);
        state.equipment.push({ id: String(pick(result, ['UbicacionEquipoID', 'id'])), name: pick(result, ['Nombre'], modal.values.nombre) });
        state.setForm((current) => ({ ...current }));
      }
      setModal(null);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setModalSaving(false);
    }
  }

  const progress = Math.round(((step + 1) / MAINTENANCE_STEPS.length) * 100);

  return <div className="page page--narrow maintenance-form-page">
    <div className="page-header ticket-form-header">
      <button className="icon-button" type="button" onClick={state.cancelMaintenanceChanges} aria-label="Cancelar edición"><Icon name="close" /></button>
      <div><span className="eyebrow">Flujo de mantenimiento</span><h1>{editing ? 'Editar mantenimiento' : 'Crear mantenimiento'}</h1></div>
      <span className={`status-chip ${state.form.estado === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{state.form.estado}</span>
    </div>
    <section className="ticket-progress"><div><strong>Paso {step + 1} de {MAINTENANCE_STEPS.length}</strong><span>{progress}% completado</span></div><div className="ticket-progress__track"><span style={{ width: `${progress}%` }} /></div></section>
    <section className="form-card ticket-form-card maintenance-form-card--wide">
      <div className="form-card__heading"><span className="section-marker" /><div><h2>Paso {step + 1}: {MAINTENANCE_STEPS[step][0]}</h2><p>{MAINTENANCE_STEPS[step][1]}</p></div></div>
      {state.error && <div className="alert alert--error"><Icon name="error" /><span>{state.error}</span></div>}
      {step === 0 && <MaintenanceGeneralStep form={state.form} setForm={state.setForm} clients={state.clients} locations={state.locations} technicians={state.technicians} disabled={state.readOnly} canCreateLocation={state.canCreateLocation} onAddLocation={() => openModal('location')} />}
      {step === 1 && <MaintenanceCountsStep counts={state.form.counts} registered={state.registered} disabled={state.readOnly} onChange={state.updateCount} />}
      {step === 2 && <MaintenanceDevicesStep devices={state.devices} expectedTotal={state.expectedTotal} disabled={state.readOnly} canCreateEquipment={state.canCreateLocation && Boolean(state.form.ubicacionId)} onAddEquipment={() => openModal('equipment')} onAddDevice={() => state.openDevice(state.createDevice())} onOpenDevice={state.openDevice} />}
      {step === 3 && <MaintenanceReviewStep form={state.form} devices={state.devices} registered={state.registered} expectedTotal={state.expectedTotal} disabled={state.readOnly} saving={state.saving} onSave={() => state.persist('pending')} onFinalize={() => state.persist('finalize')} canFinalize={isAdministrator} />}
    </section>
    <div className="ticket-form-actions maintenance-form-navigation-actions">
      <button className="button button--ghost" type="button" onClick={state.cancelMaintenanceChanges} disabled={state.saving}><Icon name="close" />Cancelar</button>
      <button className="button button--secondary" type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || state.saving}><Icon name="chevron_left" />Anterior</button>
      {step < MAINTENANCE_STEPS.length - 1
        ? <button className="button button--primary" type="button" onClick={() => setStep((value) => value + 1)} disabled={state.saving}>Siguiente<Icon name="chevron_right" /></button>
        : <button className="button button--primary" type="button" onClick={() => state.persist('pending')} disabled={state.saving || state.readOnly}>{state.saving ? 'Guardando...' : 'Guardar'}<Icon name="save" /></button>}
    </div>
    <InlineCreateModal open={Boolean(modal)} title={modal?.type === 'location' ? 'Nueva ubicación del cliente' : 'Nueva ubicación del equipo'} saving={modalSaving} error={modalError} onClose={() => setModal(null)} onSubmit={submitModal}>
      {modal && <><Field label="Nombre *" value={modal.values.nombre} onChange={(event) => setModal((current) => ({ ...current, values: { ...current.values, nombre: event.target.value } }))} />{modal.type === 'location' ? <Field label="Dirección" value={modal.values.direccion} onChange={(event) => setModal((current) => ({ ...current, values: { ...current.values, direccion: event.target.value } }))} /> : <Field label="Descripción" multiline value={modal.values.descripcion} onChange={(event) => setModal((current) => ({ ...current, values: { ...current.values, descripcion: event.target.value } }))} />}</>}
    </InlineCreateModal>
  </div>;
}
