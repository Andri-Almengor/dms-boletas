import React, { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import ProcessingOverlay from '../../components/feedback/ProcessingOverlay';
import FormField from '../../components/forms/FormField';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import MaintenanceDeviceEditor from '../../components/maintenance/MaintenanceDeviceEditor';
import MaintenanceGeneralStep from '../../components/maintenance/MaintenanceGeneralStep';
import MaintenanceCountsStep from '../../components/maintenance/MaintenanceCountsStep';
import MaintenanceDevicesStep from '../../components/maintenance/MaintenanceDevicesStep';
import MaintenanceReviewStep from '../../components/maintenance/MaintenanceReviewStep';
import { MaintenanceCountsProvider } from '../../context/MaintenanceCountsContext';
import { hasSelectedMaintenanceCategory } from '../../config/dynamicMaintenanceTypes';
import {
  maintenanceProgress,
  resolveMaintenanceDirectRequest,
} from '../../features/maintenance/maintenanceFormOrchestration';
import useMaintenanceDirectDevice from '../../features/maintenance/useMaintenanceDirectDevice';
import useMaintenanceQuickCreate from '../../features/maintenance/useMaintenanceQuickCreate';
import useMaintenanceForm from '../../hooks/useOptimizedMaintenanceForm';
import { MAINTENANCE_STEPS } from './maintenanceFormData';

export default function MaintenanceFormPage({ mode = 'create' }) {
  const { maintenanceId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const editing = mode === 'edit';
  const isAdministrator = hasPermission('USUARIOS_GESTIONAR');
  const initialRequest = resolveMaintenanceDirectRequest(searchParams, editing);
  const state = useMaintenanceForm({ editing, maintenanceId });
  const [step, setStep] = useState(initialRequest.requestedStep);
  const [processingAction, setProcessingAction] = useState('');
  const canAddExpectedDevice = hasSelectedMaintenanceCategory(state.form.counts);

  const direct = useMaintenanceDirectDevice({
    editing,
    maintenanceId,
    searchParams,
    navigate,
    setStep,
    state,
    canAddExpectedDevice,
  });

  const quickCreate = useMaintenanceQuickCreate({
    form: state.form,
    setForm: state.setForm,
    addLocation: state.addLocation,
    addEquipment: state.addEquipment,
    sessionToken: state.sessionToken,
  });

  async function persistMaintenance(action) {
    setProcessingAction(action);
    try {
      return await state.persist(action);
    } finally {
      setProcessingAction('');
    }
  }

  if (!state.allowed) return <Navigate to="/mantenimientos" replace />;
  if (state.loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimiento...</div></div>;

  if (state.activeDevice) {
    return <div className="page page--narrow maintenance-form-page maintenance-device-form-page">
      <ProcessingOverlay
        open={state.deviceSaving}
        title="Guardando dispositivo"
        message={state.activeDevice.newImages?.length
          ? `Se están guardando los datos y subiendo ${state.activeDevice.newImages.length} evidencia${state.activeDevice.newImages.length === 1 ? '' : 's'}.`
          : 'Se están guardando los datos del dispositivo y actualizando el mantenimiento.'}
      />
      <MaintenanceCountsProvider counts={state.form.counts}>
        <MaintenanceDeviceEditor
          device={state.activeDevice}
          equipmentOptions={state.equipment.map((item) => ({ value: item.id, label: item.name }))}
          maintenanceLocationId={state.form.ubicacionId}
          technicians={state.technicians}
          disabled={state.readOnly || state.saving}
          isAdmin={state.isAdmin}
          onChange={state.setActiveDevice}
          onCancel={direct.cancelDevice}
          onClose={direct.cancelDevice}
          onSubmit={direct.saveDevice}
          onSubmitAndContinue={!direct.directDeviceMode && !state.activeDevice.id ? state.saveAndAddAnotherDevice : undefined}
          onDelete={direct.deleteDevice}
          submitting={state.deviceSaving}
          autosaveStatus={state.deviceAutosaveStatus}
        />
      </MaintenanceCountsProvider>
    </div>;
  }

  if (direct.directDeviceMode) {
    if (direct.requestedNewDevice && !canAddExpectedDevice) {
      return <div className="page"><div className="empty-state"><Icon name="rule" /><h2>Seleccione los tipos del mantenimiento</h2><p>Antes de agregar dispositivos, edite las cantidades esperadas y asigne un valor mayor que cero al menos a un tipo.</p><button className="button button--primary" type="button" onClick={() => navigate(`/mantenimientos/${encodeURIComponent(maintenanceId)}/editar`)}><Icon name="edit" />Editar cantidades</button><button className="button button--secondary" type="button" onClick={() => navigate(direct.detailUrl)}><Icon name="arrow_back" />Volver al detalle</button></div></div>;
    }
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Abriendo formulario del dispositivo...</div></div>;
  }

  function addDevice() {
    if (!canAddExpectedDevice) {
      state.setError('Primero indique una cantidad mayor que cero para al menos un tipo de dispositivo.');
      setStep(1);
      return;
    }
    state.openDevice(state.createDevice());
  }

  const progress = maintenanceProgress(step, MAINTENANCE_STEPS.length);
  const finalizing = processingAction === 'finalize';

  return <div className="page page--narrow maintenance-form-page">
    <ProcessingOverlay
      open={state.saving || Boolean(processingAction)}
      title={finalizing ? 'Finalizando mantenimiento' : 'Guardando mantenimiento'}
      message={finalizing
        ? 'Se están guardando los datos, los dispositivos y las evidencias antes de finalizar.'
        : 'Se están guardando los datos, los dispositivos y las evidencias del mantenimiento.'}
    />
    <div className="page-header ticket-form-header">
      <button className="icon-button" type="button" onClick={state.cancelMaintenanceChanges} aria-label="Cancelar edición"><Icon name="close" /></button>
      <div><span className="eyebrow">Flujo de mantenimiento</span><h1>{editing ? 'Editar mantenimiento' : 'Crear mantenimiento'}</h1></div>
      <span className={`status-chip ${state.form.estado === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{state.form.estado}</span>
    </div>
    <section className="ticket-progress"><div><strong>Paso {step + 1} de {MAINTENANCE_STEPS.length}</strong><span>{progress}% completado</span></div><div className="ticket-progress__track"><span style={{ width: `${progress}%` }} /></div></section>
    <section className="form-card ticket-form-card maintenance-form-card--wide">
      <div className="form-card__heading"><span className="section-marker" /><div><h2>Paso {step + 1}: {MAINTENANCE_STEPS[step][0]}</h2><p>{MAINTENANCE_STEPS[step][1]}</p></div></div>
      {state.error && <div className="alert alert--error"><Icon name="error" /><span>{state.error}</span></div>}
      {step === 0 && <MaintenanceGeneralStep form={state.form} setForm={state.setForm} clients={state.clients} locations={state.locations} technicians={state.technicians} disabled={state.readOnly} canCreateLocation={state.canCreateLocation} onAddLocation={() => quickCreate.openModal('location')} onSearchClients={state.searchClients} />}
      {step === 1 && <MaintenanceCountsStep counts={state.form.counts} registered={state.registered} disabled={state.readOnly} onChange={state.updateCount} />}
      {step === 2 && <MaintenanceDevicesStep devices={state.devices} expectedTotal={state.expectedTotal} disabled={state.readOnly} canAddDevice={canAddExpectedDevice} canCreateEquipment={state.canCreateLocation && Boolean(state.form.ubicacionId)} onAddEquipment={() => quickCreate.openModal('equipment')} onAddDevice={addDevice} onOpenDevice={state.openDevice} />}
      {step === 3 && <MaintenanceReviewStep form={state.form} devices={state.devices} registered={state.registered} expectedTotal={state.expectedTotal} disabled={state.readOnly} saving={state.saving} onSave={() => persistMaintenance('pending')} onFinalize={() => persistMaintenance('finalize')} canFinalize={isAdministrator} />}
    </section>
    <div className="ticket-form-actions maintenance-form-navigation-actions">
      <button className="button button--ghost" type="button" onClick={state.cancelMaintenanceChanges} disabled={state.saving}><Icon name="close" />Cancelar</button>
      <button className="button button--secondary" type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || state.saving}><Icon name="chevron_left" />Anterior</button>
      {step < MAINTENANCE_STEPS.length - 1
        ? <button className="button button--primary" type="button" onClick={() => setStep((value) => value + 1)} disabled={state.saving}>Siguiente<Icon name="chevron_right" /></button>
        : <button className="button button--primary" type="button" onClick={() => persistMaintenance('pending')} disabled={state.saving || state.readOnly}>{state.saving ? 'Guardando...' : 'Guardar'}<Icon name="save" /></button>}
    </div>
    <InlineCreateModal
      open={Boolean(quickCreate.modal)}
      title={quickCreate.modal?.type === 'location' ? 'Nueva ubicación del cliente' : 'Nueva ubicación del equipo'}
      saving={quickCreate.saving}
      error={quickCreate.error}
      onClose={quickCreate.closeModal}
      onSubmit={quickCreate.submitModal}
    >
      {quickCreate.modal && <>
        <FormField label="Nombre *" name="nombre" value={quickCreate.modal.values.nombre} onChange={quickCreate.updateModal} />
        {quickCreate.modal.type === 'location'
          ? <FormField label="Dirección" name="direccion" value={quickCreate.modal.values.direccion} onChange={quickCreate.updateModal} />
          : <FormField label="Descripción" multiline name="descripcion" value={quickCreate.modal.values.descripcion} onChange={quickCreate.updateModal} />}
      </>}
    </InlineCreateModal>
  </div>;
}
