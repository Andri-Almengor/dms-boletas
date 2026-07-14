import React, { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
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
  const editing = mode === 'edit';
  const state = useMaintenanceForm({ editing, maintenanceId });
  const [step, setStep] = useState(0);
  const [modal, setModal] = useState(null);
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  if (!state.allowed) return <Navigate to="/mantenimientos" replace />;
  if (state.loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimiento...</div></div>;

  if (state.activeDevice) {
    return <div className="page page--narrow maintenance-form-page">
      <MaintenanceDeviceEditor
        device={state.activeDevice}
        equipmentOptions={state.equipment.map((item) => ({ value: item.id, label: item.name }))}
        disabled={state.readOnly || state.saving}
        isAdmin={state.isAdmin}
        onChange={state.setActiveDevice}
        onClose={state.closeActiveDevice}
        onSubmit={() => state.commitActiveDevice(state.activeDevice, { automatic: false, closeAfter: true })}
        onDelete={() => state.removeDevice(state.activeDevice)}
        submitting={state.deviceSaving}
        autosaveStatus={state.deviceAutosaveStatus}
      />
    </div>;
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
      <button className="icon-button" type="button" onClick={() => navigate(editing ? `/mantenimientos/${encodeURIComponent(maintenanceId)}` : '/mantenimientos')}><Icon name="close" /></button>
      <div><span className="eyebrow">Flujo de mantenimiento</span><h1>{editing ? 'Editar mantenimiento' : 'Crear mantenimiento'}</h1></div>
      <span className={`status-chip ${state.form.estado === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{state.form.estado}</span>
    </div>
    <section className="ticket-progress"><div><strong>Paso {step + 1} de {MAINTENANCE_STEPS.length}</strong><span>{progress}% completado</span></div><div className="ticket-progress__track"><span style={{ width: `${progress}%` }} /></div></section>
    <section className="form-card ticket-form-card">
      <div className="form-card__heading"><span className="section-marker" /><div><h2>Paso {step + 1}: {MAINTENANCE_STEPS[step][0]}</h2><p>{MAINTENANCE_STEPS[step][1]}</p></div></div>
      {state.error && <div className="alert alert--error"><Icon name="error" /><span>{state.error}</span></div>}
      {step === 0 && <MaintenanceGeneralStep form={state.form} setForm={state.setForm} clients={state.clients} locations={state.locations} technicians={state.technicians} disabled={state.readOnly} canCreateLocation={state.canCreateLocation} onAddLocation={() => openModal('location')} />}
      {step === 1 && <MaintenanceCountsStep counts={state.form.counts} registered={state.registered} disabled={state.readOnly} onChange={state.updateCount} />}
      {step === 2 && <MaintenanceDevicesStep devices={state.devices} expectedTotal={state.expectedTotal} disabled={state.readOnly} canCreateEquipment={state.canCreateLocation && Boolean(state.form.ubicacionId)} onAddEquipment={() => openModal('equipment')} onAddDevice={() => state.setActiveDevice(state.createDevice())} onOpenDevice={(device) => { state.setActiveDevice(device); }} />}
      {step === 3 && <MaintenanceReviewStep form={state.form} devices={state.devices} registered={state.registered} expectedTotal={state.expectedTotal} disabled={state.readOnly} saving={state.saving} onSave={() => state.persist('pending')} onFinalize={() => state.persist('finalize')} />}
    </section>
    <div className="ticket-form-actions">
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
