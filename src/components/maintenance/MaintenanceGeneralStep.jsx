import React from 'react';
import DependentSelect from '../forms/DependentSelect';
import TechnicianMultiSelect from '../forms/TechnicianMultiSelect';

function Field({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="5" {...props} /> : <input className="form-control" {...props} />}</label>;
}

export default function MaintenanceGeneralStep({ form, setForm, clients, locations, technicians, disabled, canCreateLocation, onAddLocation }) {
  const clientOptions = clients.map((item) => ({ value: item.id, label: item.name }));
  const locationOptions = locations.map((item) => ({ value: item.id, label: item.name }));
  function update(event) { const { name, value } = event.target; setForm((current) => ({ ...current, [name]: value })); }
  function chooseClient(event) {
    const id = event.target.value;
    const selected = clients.find((item) => item.id === id);
    setForm((current) => ({ ...current, clienteId: id, cliente: selected?.name || '', ubicacionId: '', ubicacion: '' }));
  }
  function chooseLocation(event) {
    const id = event.target.value;
    const selected = locations.find((item) => item.id === id);
    setForm((current) => ({ ...current, ubicacionId: id, ubicacion: selected?.name || '' }));
  }
  return <div className="stack-form">
    <Field label="Título del mantenimiento *" name="titulo" value={form.titulo} onChange={update} disabled={disabled} />
    <DependentSelect label="Cliente *" value={form.clienteId} options={clientOptions} onChange={chooseClient} disabled={disabled} />
    <DependentSelect label="Ubicación del cliente" value={form.ubicacionId} options={locationOptions} onChange={chooseLocation} disabled={disabled || !form.clienteId} canAdd={!disabled && canCreateLocation && Boolean(form.clienteId)} onAdd={onAddLocation} />
    <div className="ticket-form-grid"><Field label="Fecha *" type="date" name="fecha" value={form.fecha} onChange={update} disabled={disabled} /><Field label="Fecha de finalización" type="date" name="fechaFinalizacion" value={form.fechaFinalizacion} onChange={update} disabled={disabled} /></div>
    <div className="field-group"><span className="field-label">Responsables *</span><TechnicianMultiSelect users={technicians} selectedIds={form.responsables} onChange={(responsables) => setForm((current) => ({ ...current, responsables }))} disabled={disabled} /></div>
    <Field label="Descripción general" multiline name="descripcion" value={form.descripcion} onChange={update} disabled={disabled} />
  </div>;
}
