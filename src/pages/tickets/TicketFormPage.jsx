import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import AutosaveIndicator from '../../components/feedback/AutosaveIndicator';
import DependentSelect from '../../components/forms/DependentSelect';
import EvidenceUploader from '../../components/forms/EvidenceUploader';
import FormField from '../../components/forms/FormField';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import TechnicianMultiSelect from '../../components/forms/TechnicianMultiSelect';
import SignaturePad from '../../components/tickets/SignaturePad';
import TechnicalWritingAssistant from '../../components/tickets/TechnicalWritingAssistant';
import {
  buildTicketFormOptions,
  buildTicketTechnicians,
  calculateTicketHours,
  EMPTY_TICKET_FORM,
  findTicketRecord,
  TICKET_FORM_IDS,
  TICKET_FORM_STEPS,
  validateTicketStep,
} from '../../features/tickets/ticketFormDomain';
import useTicketFormResources from '../../features/tickets/useTicketFormResources';
import useTicketPersistence from '../../features/tickets/useTicketPersistence';
import useTicketQuickCreate from '../../features/tickets/useTicketQuickCreate';
import useTicketDraft from '../../hooks/useTicketDraft';
import { pick } from '../../services/moduleApi';

export default function TicketFormPage({ mode = 'create' }) {
  const { boletaUid } = useParams();
  const { sessionToken, user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const editing = mode === 'edit';
  const allowed = editing ? hasPermission('BOLETAS_EDITAR') : hasPermission('BOLETAS_CREAR');
  const manageCatalogs = hasPermission('CATALOGOS_GESTIONAR') || hasPermission('BOLETAS_CREAR') || hasPermission('BOLETAS_EDITAR');
  const createOperational = hasPermission('CLIENTES_DATOS_OPERATIVOS_CREAR') || hasPermission('CLIENTES_EDITAR');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    ...EMPTY_TICKET_FORM,
    asignados: user?.UsuarioID ? [String(user.UsuarioID)] : [],
  });
  const [evidences, setEvidences] = useState([]);
  const [error, setError] = useState('');

  const {
    catalogs,
    locations,
    equipmentLocations,
    contacts,
    existingEvidenceCount,
    loading,
    reloadCatalogs,
    appendRelation,
  } = useTicketFormResources({
    editing,
    boletaUid,
    sessionToken,
    clientId: form.clienteId,
    equipmentLocationId: form.ubicacionId,
    setForm,
    onError: setError,
  });

  const restore = useCallback((draftData) => {
    if (draftData.form) {
      setForm((current) => ({
        ...current,
        ...draftData.form,
        nombreDispositivo: draftData.form.nombreDispositivo
          || draftData.form.descripcion
          || draftData.form.descripcionEquipo
          || current.nombreDispositivo,
      }));
    }
    if (Number.isInteger(draftData.step)) setStep(draftData.step);
  }, []);

  const draft = useTicketDraft({
    keySuffix: editing ? boletaUid : 'new',
    enabled: !loading,
    value: { form, step },
    onRestore: restore,
  });

  const {
    modal,
    modalError,
    modalSaving,
    openModal,
    closeModal,
    modalUpdate,
    submitModal,
  } = useTicketQuickCreate({
    form,
    setForm,
    sessionToken,
    reloadCatalogs,
    appendRelation,
  });

  const { action, saving, serverStatus } = useTicketPersistence({
    editing,
    loading,
    boletaUid,
    form,
    evidences,
    sessionToken,
    clearDraft: draft.clearDraft,
    navigate,
    setError,
  });
  const autosaveStatus = editing && serverStatus !== 'idle' ? serverStatus : draft.status;

  useEffect(() => {
    const total = calculateTicketHours(form.horaInicio, form.horaFinal);
    setForm((current) => current.horasTotales === total ? current : { ...current, horasTotales: total });
  }, [form.horaInicio, form.horaFinal]);

  const opt = buildTicketFormOptions({ catalogs, locations, equipmentLocations, contacts, form });
  const technicians = buildTicketTechnicians(catalogs.users);

  function update(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  }

  function choose(event, rows, idKeys, idField, nameField, nameKeys, reset = {}, extra) {
    const value = event.target.value;
    const row = findTicketRecord(rows, value, idKeys);
    setForm((current) => ({
      ...current,
      [idField]: value,
      [nameField]: pick(row, nameKeys, ''),
      ...reset,
      ...(extra ? extra(row) : {}),
    }));
  }

  function addFiles(event) {
    const files = Array.from(event.target.files || []);
    setEvidences((current) => [
      ...current,
      ...files.map((file) => ({
        localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        file,
        name: file.name,
        note: '',
        mimeType: file.type || 'application/octet-stream',
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      })),
    ]);
    event.target.value = '';
  }

  function next() {
    const message = validateTicketStep(form, step);
    if (message) return setError(message);
    setError('');
    setStep((value) => Math.min(TICKET_FORM_STEPS.length - 1, value + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!allowed) return <Navigate to="/boletas/pendientes" replace />;
  if (loading) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando formulario...</div></div>;
  }

  const progress = Math.round(((step + 1) / TICKET_FORM_STEPS.length) * 100);
  const selectedNames = technicians
    .filter((item) => form.asignados.includes(item.value))
    .map((item) => item.label)
    .join(', ');

  return (
    <div className="page page--narrow ticket-form-page">
      <div className="page-header ticket-form-header">
        <button className="icon-button" type="button" onClick={() => navigate(editing ? `/boletas/${encodeURIComponent(boletaUid)}` : '/boletas/pendientes')}>
          <Icon name="close" />
        </button>
        <div><span className="eyebrow">Flujo de trabajo</span><h1>{editing ? 'Editar Boleta' : 'Crear Boleta'}</h1></div>
        <AutosaveIndicator status={autosaveStatus} />
      </div>

      <section className="ticket-progress">
        <div><strong>Paso {step + 1} de {TICKET_FORM_STEPS.length}</strong><span>{progress}% completado</span></div>
        <div className="ticket-progress__track"><span style={{ width: `${progress}%` }} /></div>
      </section>

      <section className="form-card ticket-form-card">
        <div className="form-card__heading">
          <span className="section-marker" />
          <div><h2>Paso {step + 1}: {TICKET_FORM_STEPS[step][0]}</h2><p>{TICKET_FORM_STEPS[step][1]}</p></div>
        </div>
        {error && <div className="alert alert--error"><Icon name="error" /> {error}</div>}
        <div className="stack-form">
          {step === 0 && <>
            <FormField label="Título" name="titulo" value={form.titulo} onChange={update} required />
            <div className="ticket-form-grid">
              <DependentSelect label="Categoría" name="categoriaId" value={form.categoriaId} options={opt.categories} required canAdd={manageCatalogs} onAdd={() => openModal('category')} onChange={(event) => choose(event, catalogs.categories, TICKET_FORM_IDS.categories, 'categoriaId', 'categoria', ['Nombre'])} />
              <DependentSelect label="Tipo de falla" name="tipoFallaId" value={form.tipoFallaId} options={opt.failures} required canAdd={manageCatalogs} onAdd={() => openModal('failure')} onChange={(event) => choose(event, catalogs.failures, TICKET_FORM_IDS.failures, 'tipoFallaId', 'tipoFalla', ['Nombre'])} />
            </div>
            <div className="ticket-form-grid ticket-form-grid--three">
              <FormField label="Fecha" type="date" name="fecha" value={form.fecha} onChange={update} />
              <FormField label="Hora inicio" type="time" name="horaInicio" value={form.horaInicio} onChange={update} />
              <FormField label="Hora final" type="time" name="horaFinal" value={form.horaFinal} onChange={update} />
            </div>
            <FormField label="Horas totales" type="number" step="0.01" name="horasTotales" value={form.horasTotales} onChange={update} hint="Cálculo automático, incluso cruzando medianoche." />
          </>}

          {step === 1 && <>
            <DependentSelect label="Cliente" name="clienteId" value={form.clienteId} options={opt.clients} required onChange={(event) => choose(event, catalogs.clients, TICKET_FORM_IDS.clients, 'clienteId', 'cliente', ['Nombre', 'Clientes'], { ubicacionId: '', ubicacion: '', ubicacionEquipoId: '', ubicacionEquipo: '', supervisorId: '', supervisor: '', correoSupervisor: '' }, (row) => ({ correoCliente: pick(row, ['CorreoGeneral', 'Correo']) }))} />
            <div className="ticket-form-grid">
              <DependentSelect label="Ubicación" name="ubicacionId" value={form.ubicacionId} options={opt.locations} disabled={!form.clienteId} canAdd={createOperational && Boolean(form.clienteId)} onAdd={() => openModal('location')} onChange={(event) => choose(event, locations, ['UbicacionID', 'id'], 'ubicacionId', 'ubicacion', ['Nombre'], { ubicacionEquipoId: '', ubicacionEquipo: '' })} />
              <DependentSelect label="Ubicación del equipo" name="ubicacionEquipoId" value={form.ubicacionEquipoId} options={opt.equipment} disabled={!form.ubicacionId} canAdd={createOperational && Boolean(form.ubicacionId)} onAdd={() => openModal('equipment')} onChange={(event) => choose(event, equipmentLocations, ['UbicacionEquipoID', 'id'], 'ubicacionEquipoId', 'ubicacionEquipo', ['Nombre'])} />
            </div>
            <DependentSelect label="Supervisor" name="supervisorId" value={form.supervisorId} options={opt.supervisors} disabled={!form.clienteId} canAdd={createOperational && Boolean(form.clienteId)} onAdd={() => openModal('supervisor')} onChange={(event) => choose(event, contacts, ['ContactoID', 'id'], 'supervisorId', 'supervisor', ['Nombre'], {}, (row) => ({ correoSupervisor: pick(row, ['Correo']) }))} />
            <div className="ticket-form-grid">
              <FormField label="Correo supervisor" type="email" name="correoSupervisor" value={form.correoSupervisor} onChange={update} readOnly={!hasPermission('CLIENTES_EDITAR')} />
              <FormField label="Correo cliente" type="email" name="correoCliente" value={form.correoCliente} onChange={update} readOnly={!hasPermission('CLIENTES_EDITAR')} />
            </div>
          </>}

          {step === 2 && <>
            <DependentSelect label="Tipo de dispositivo" name="tipoDispositivoId" value={form.tipoDispositivoId} options={opt.devices} required canAdd={manageCatalogs} onAdd={() => openModal('device')} onChange={(event) => choose(event, catalogs.devices, TICKET_FORM_IDS.devices, 'tipoDispositivoId', 'tipoDispositivo', ['Nombre'], { fabricanteId: '', fabricante: '', modeloId: '', modelo: '' })} />
            <FormField label="Nombre del dispositivo" name="nombreDispositivo" value={form.nombreDispositivo} onChange={update} required />
            <div className="ticket-form-grid">
              <DependentSelect label="Fabricante" name="fabricanteId" value={form.fabricanteId} options={opt.manufacturers} disabled={!form.tipoDispositivoId} canAdd={manageCatalogs && Boolean(form.tipoDispositivoId)} onAdd={() => openModal('manufacturer')} onChange={(event) => choose(event, catalogs.manufacturers, TICKET_FORM_IDS.manufacturers, 'fabricanteId', 'fabricante', ['Nombre'], { modeloId: '', modelo: '' })} />
              <DependentSelect label="Modelo" name="modeloId" value={form.modeloId} options={opt.models} disabled={!form.tipoDispositivoId || !form.fabricanteId} canAdd={manageCatalogs && Boolean(form.fabricanteId)} onAdd={() => openModal('model')} onChange={(event) => choose(event, catalogs.models, TICKET_FORM_IDS.models, 'modeloId', 'modelo', ['Nombre'])} />
            </div>
            <FormField label="Serie" name="serie" value={form.serie} onChange={update} />
          </>}

          {step === 3 && <>
            <TechnicalWritingAssistant form={form} setForm={setForm} disabled={saving} />
            <FormField label="Razón de visita" multiline name="razonVisita" value={form.razonVisita} onChange={update} />
            <FormField label="Pruebas realizadas" multiline name="pruebasRealizadas" value={form.pruebasRealizadas} onChange={update} />
            <FormField label="Resultado" multiline name="resultado" value={form.resultado} onChange={update} />
            <FormField label="Recomendaciones" multiline name="recomendaciones" value={form.recomendaciones} onChange={update} />
          </>}

          {step === 4 && <TechnicianMultiSelect users={technicians} selectedIds={form.asignados} onChange={(asignados) => setForm((current) => ({ ...current, asignados }))} disabled={saving} />}
          {step === 5 && <EvidenceUploader items={evidences} onAdd={addFiles} onUpdate={(index, patch) => setEvidences((rows) => rows.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row))} onRemove={(index) => setEvidences((rows) => rows.filter((_, itemIndex) => itemIndex !== index))} disabled={saving} />}
          {step === 6 && <>
            <SignaturePad value={form.firma} onChange={(firma) => setForm((current) => ({ ...current, firma }))} />
            {editing && !form.firma && <div className="info-box"><Icon name="info" /><p>La firma existente se conserva si no dibuja una nueva.</p></div>}
          </>}

          {step === 7 && <>
            <div className="ticket-review-list">
              {[
                ['Cliente', form.cliente],
                ['Ubicación', [form.ubicacion, form.ubicacionEquipo].filter(Boolean).join(' · ')],
                ['Supervisor', form.supervisor],
                ['Nombre del dispositivo', form.nombreDispositivo],
                ['Dispositivo', [form.tipoDispositivo, form.fabricante, form.modelo, form.serie].filter(Boolean).join(' · ')],
                ['Técnicos', selectedNames],
                ['Evidencias', `${existingEvidenceCount + evidences.length} archivo(s)`],
                ['Categoría', form.categoria],
                ['Tipo de falla', form.tipoFalla],
                ['Resultado', form.resultado],
              ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || 'Sin especificar'}</strong></div>)}
            </div>
            <label className="check-card">
              <input type="checkbox" name="enviarCorreoCliente" checked={form.enviarCorreoCliente} onChange={update} />
              <Icon name={form.enviarCorreoCliente ? 'check_box' : 'check_box_outline_blank'} />
              <div><strong>Enviar copia al cliente</strong><small>Incluye al cliente en la notificación final.</small></div>
            </label>
            <FormField label="Correos CC" name="correosCC" value={form.correosCC} onChange={update} hint="Separe varios correos con coma." />
            <div className="review-action-grid">
              <button className="button button--secondary" type="button" onClick={() => action('pdf')} disabled={saving}><Icon name="picture_as_pdf" /> Generar PDF</button>
              {hasPermission('NOTIFICACIONES_PRUEBA') && <button className="button button--secondary" type="button" onClick={() => action('test')} disabled={saving}><Icon name="science" /> Probar PDF, Chat y correo</button>}
              {hasPermission('BOLETAS_FINALIZAR') && <button className="button button--primary" type="button" onClick={() => action('finalize')} disabled={saving}><Icon name="task_alt" /> Finalizar</button>}
            </div>
          </>}
        </div>
      </section>

      <div className="ticket-form-actions">
        <button className="button button--secondary" type="button" onClick={() => step ? setStep((value) => value - 1) : navigate('/boletas/pendientes')} disabled={saving}>
          <Icon name={step ? 'chevron_left' : 'close'} /> {step ? 'Anterior' : 'Cancelar'}
        </button>
        {step < TICKET_FORM_STEPS.length - 1
          ? <button className="button button--primary" type="button" onClick={next} disabled={saving}>Siguiente <Icon name="chevron_right" /></button>
          : <button className="button button--primary" type="button" onClick={() => action('save')} disabled={saving}><Icon name="save" /> {saving ? 'Guardando...' : 'Guardar pendiente'}</button>}
      </div>

      <InlineCreateModal
        open={Boolean(modal)}
        title={`Agregar ${modal?.type || ''}`}
        description="El registro quedará disponible para futuras boletas."
        saving={modalSaving}
        error={modalError}
        onClose={closeModal}
        onSubmit={submitModal}
      >
        {modal && <>
          <FormField label="Nombre" name="nombre" value={modal.values.nombre} onChange={modalUpdate} required />
          {modal.type === 'supervisor' && <>
            <FormField label="Correo" type="email" name="correo" value={modal.values.correo} onChange={modalUpdate} required />
            <div className="ticket-form-grid">
              <FormField label="Puesto" name="puesto" value={modal.values.puesto} onChange={modalUpdate} />
              <FormField label="Teléfono" name="telefono" value={modal.values.telefono} onChange={modalUpdate} />
            </div>
          </>}
          {modal.type === 'location' && <>
            <FormField label="Dirección" name="direccion" value={modal.values.direccion} onChange={modalUpdate} />
            <FormField label="Notas" multiline name="notas" value={modal.values.notas} onChange={modalUpdate} />
          </>}
          {['equipment', 'category', 'failure', 'device', 'model'].includes(modal.type) && <FormField label="Descripción" multiline name="descripcion" value={modal.values.descripcion} onChange={modalUpdate} />}
          {modal.type === 'model' && <FormField label="Imagen de referencia (URL)" name="imagenReferenciaURL" value={modal.values.imagenReferenciaURL} onChange={modalUpdate} />}
        </>}
      </InlineCreateModal>
    </div>
  );
}
