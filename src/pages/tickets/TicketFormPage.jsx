import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import SignaturePad from '../../components/tickets/SignaturePad';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

const steps = [
  ['Información general', 'Datos principales del servicio.'],
  ['Cliente', 'Identificación y contacto del cliente.'],
  ['Ubicación', 'Dirección y motivo de la visita.'],
  ['Equipo', 'Datos del dispositivo o sistema.'],
  ['Trabajo', 'Diagnóstico, resultado y recomendaciones.'],
  ['Evidencias', 'Fotografías del trabajo realizado.'],
  ['Firma', 'Conformidad del cliente.'],
  ['Revisión', 'Verifica todo antes de guardar.'],
];

const emptyForm = {
  titulo: '', categoria: '', fecha: new Date().toISOString().slice(0, 10), horaInicio: '', horaFinal: '',
  clienteId: '', cliente: '', contacto: '', correoCliente: '', ubicacion: '', razonVisita: '',
  fabricante: '', modelo: '', serie: '', ubicacionEquipo: '', descripcion: '', tipoFalla: '',
  resultado: '', pruebasRealizadas: '', recomendaciones: '', supervisor: '', firmaNombre: '', firma: '',
};

function TextField({ label, multiline = false, ...props }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {multiline ? <textarea className="form-control ticket-textarea" rows="4" {...props} /> : <input className="form-control" {...props} />}
    </label>
  );
}

function SelectField({ label, options, ...props }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      <select className="form-control" {...props}>
        <option value="">Seleccione una opción</option>
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value;
          const text = typeof option === 'string' ? option : option.label;
          return <option value={value} key={value}>{text}</option>;
        })}
      </select>
    </label>
  );
}

async function fileToPayload(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { nombre: file.name, tipo: file.type, dataUrl, contenidoBase64: String(dataUrl).split(',')[1] || '' };
}

function mapTicketToForm(ticket) {
  return {
    titulo: pick(ticket, ['Titulo', 'Título', 'titulo']),
    categoria: pick(ticket, ['Categoria', 'Categoría', 'categoria']),
    fecha: String(pick(ticket, ['Fecha', 'fecha'], new Date().toISOString().slice(0, 10))).slice(0, 10),
    horaInicio: pick(ticket, ['HoraInicio', 'horaInicio']),
    horaFinal: pick(ticket, ['HoraFinal', 'horaFinal']),
    clienteId: pick(ticket, ['ClienteID', 'clienteId']),
    cliente: pick(ticket, ['Cliente', 'ClienteNombre', 'cliente']),
    contacto: pick(ticket, ['Contacto', 'contacto']),
    correoCliente: pick(ticket, ['Correo_Cliente', 'CorreoCliente', 'correoCliente']),
    ubicacion: pick(ticket, ['Ubicacion', 'Ubicación', 'ubicacion']),
    razonVisita: pick(ticket, ['Razon_visita', 'RazonVisita', 'razonVisita']),
    fabricante: pick(ticket, ['Fabricante', 'fabricante']),
    modelo: pick(ticket, ['Modelo', 'modelo']),
    serie: pick(ticket, ['Serie', 'serie']),
    ubicacionEquipo: pick(ticket, ['Ubicacion_equipo', 'UbicacionEquipo', 'ubicacionEquipo']),
    descripcion: pick(ticket, ['Descripcion', 'Descripción', 'descripcion']),
    tipoFalla: pick(ticket, ['TipoFalla', 'Tipo de falla', 'tipoFalla']),
    resultado: pick(ticket, ['Resultado', 'resultado']),
    pruebasRealizadas: pick(ticket, ['Pruebas_realizadas', 'PruebasRealizadas', 'pruebasRealizadas']),
    recomendaciones: pick(ticket, ['Recomendaciones', 'recomendaciones']),
    supervisor: pick(ticket, ['Supervisor', 'supervisor']),
    firmaNombre: pick(ticket, ['FirmaNombre', 'firmaNombre']),
    firma: pick(ticket, ['Firma', 'FirmaUrl', 'firma']),
  };
}

export default function TicketFormPage({ mode = 'create' }) {
  const { boletaId } = useParams();
  const { sessionToken } = useAuth();
  const navigate = useNavigate();
  const editing = mode === 'edit';
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [images, setImages] = useState([]);
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    requestAvailable(MODULE_ROUTES.clients.list, { page: 1, pageSize: 300, sortBy: 'Clientes', sortDir: 'asc' }, sessionToken)
      .then((data) => setClients(normalizeItems(data)))
      .catch(() => {});
    requestAvailable(MODULE_ROUTES.categories.list, { page: 1, pageSize: 300, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken)
      .then((data) => setCategories(normalizeItems(data)))
      .catch(() => {});
  }, [sessionToken]);

  useEffect(() => {
    if (!editing) return;
    requestAvailable(MODULE_ROUTES.tickets.get, { boletaId, ticketId: boletaId, id: boletaId }, sessionToken)
      .then((data) => setForm(mapTicketToForm(data?.boleta || data?.ticket || data)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [editing, boletaId, sessionToken]);

  const categoryOptions = useMemo(() => {
    const mapped = categories.map((item) => ({
      value: pick(item, ['Nombre', 'Categoria', 'Categoría', 'name']),
      label: pick(item, ['Nombre', 'Categoria', 'Categoría', 'name']),
    })).filter((item) => item.value);
    return mapped.length ? mapped : ['Mantenimiento', 'Instalación', 'Reparación', 'Inspección técnica'];
  }, [categories]);

  const clientOptions = useMemo(() => clients.map((item) => ({
    value: pick(item, ['ClienteID', 'ID', 'RowID', 'id']),
    label: pick(item, ['Clientes', 'Cliente', 'Nombre', 'name']),
    record: item,
  })).filter((item) => item.value && item.label), [clients]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function selectClient(event) {
    const clienteId = event.target.value;
    const selected = clientOptions.find((item) => String(item.value) === String(clienteId));
    setForm((current) => ({
      ...current,
      clienteId,
      cliente: selected?.label || current.cliente,
      contacto: pick(selected?.record, ['Contacto', 'contacto'], current.contacto),
      correoCliente: pick(selected?.record, ['Correo', 'correo'], current.correoCliente),
      ubicacion: pick(selected?.record, ['DireccionEnvio', 'Dirección envío', 'Direccion', 'Dirección'], current.ubicacion),
    }));
  }

  function addImages(event) {
    const files = Array.from(event.target.files || []);
    setImages((current) => [...current, ...files.map((file) => ({ file, url: URL.createObjectURL(file), name: file.name }))]);
    event.target.value = '';
  }

  function nextStep() {
    setError('');
    if (step === 0 && (!form.titulo || !form.categoria || !form.fecha)) {
      setError('Complete el título, la categoría y la fecha para continuar.');
      return;
    }
    if (step === 1 && !form.cliente) {
      setError('Seleccione o escriba el cliente para continuar.');
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function saveTicket() {
    setSaving(true);
    setError('');
    try {
      const evidencias = await Promise.all(images.map((image) => fileToPayload(image.file)));
      const payload = {
        ...form,
        boletaId,
        ticketId: boletaId,
        id: boletaId,
        BoletaID: boletaId,
        Titulo: form.titulo,
        Categoria: form.categoria,
        Fecha: form.fecha,
        HoraInicio: form.horaInicio,
        HoraFinal: form.horaFinal,
        ClienteID: form.clienteId,
        Cliente: form.cliente,
        Contacto: form.contacto,
        Correo_Cliente: form.correoCliente,
        Ubicacion: form.ubicacion,
        Razon_visita: form.razonVisita,
        Fabricante: form.fabricante,
        Modelo: form.modelo,
        Serie: form.serie,
        Ubicacion_equipo: form.ubicacionEquipo,
        Descripcion: form.descripcion,
        TipoFalla: form.tipoFalla,
        Resultado: form.resultado,
        Pruebas_realizadas: form.pruebasRealizadas,
        Recomendaciones: form.recomendaciones,
        Supervisor: form.supervisor,
        FirmaNombre: form.firmaNombre,
        Firma: form.firma,
        Evidencias: evidencias,
        Imagenes: evidencias,
        Estado: editing ? undefined : 'PENDIENTE',
      };
      const result = await requestAvailable(editing ? MODULE_ROUTES.tickets.update : MODULE_ROUTES.tickets.create, payload, sessionToken);
      const id = pick(result, ['BoletaID', 'TicketID', 'id'], boletaId);
      navigate(id ? `/boletas/${encodeURIComponent(id)}` : '/boletas/pendientes');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const progress = Math.round(((step + 1) / steps.length) * 100);

  if (loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boleta...</span></div></div>;

  return (
    <div className="page page--narrow ticket-form-page">
      <div className="page-header">
        <button className="icon-button" type="button" onClick={() => navigate(editing ? `/boletas/${encodeURIComponent(boletaId)}` : '/')}><Icon name="close" /></button>
        <div><span className="eyebrow">Flujo de trabajo</span><h1>{editing ? 'Editar boleta' : 'Crear boleta'}</h1></div>
      </div>

      <section className="ticket-progress">
        <div><strong>Paso {step + 1} de {steps.length}</strong><span>{progress}% completado</span></div>
        <div className="ticket-progress__track"><span style={{ width: `${progress}%` }} /></div>
      </section>

      <section className="form-card ticket-form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>{steps[step][0]}</h2><p>{steps[step][1]}</p></div></div>
        {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

        <div className="stack-form">
          {step === 0 && <>
            <TextField label="Título de la boleta" name="titulo" value={form.titulo} onChange={updateField} placeholder="Ej: Mantenimiento preventivo" />
            <SelectField label="Categoría" name="categoria" value={form.categoria} onChange={updateField} options={categoryOptions} />
            <div className="ticket-form-grid ticket-form-grid--three">
              <TextField label="Fecha" name="fecha" type="date" value={form.fecha} onChange={updateField} />
              <TextField label="Hora inicio" name="horaInicio" type="time" value={form.horaInicio} onChange={updateField} />
              <TextField label="Hora final" name="horaFinal" type="time" value={form.horaFinal} onChange={updateField} />
            </div>
          </>}

          {step === 1 && <>
            {clientOptions.length > 0 && <SelectField label="Cliente registrado" name="clienteId" value={form.clienteId} onChange={selectClient} options={clientOptions} />}
            <TextField label="Nombre del cliente" name="cliente" value={form.cliente} onChange={updateField} />
            <div className="ticket-form-grid"><TextField label="Contacto" name="contacto" value={form.contacto} onChange={updateField} /><TextField label="Correo" type="email" name="correoCliente" value={form.correoCliente} onChange={updateField} /></div>
          </>}

          {step === 2 && <>
            <TextField label="Ubicación del servicio" name="ubicacion" value={form.ubicacion} onChange={updateField} multiline />
            <TextField label="Razón de la visita" name="razonVisita" value={form.razonVisita} onChange={updateField} multiline />
          </>}

          {step === 3 && <>
            <div className="ticket-form-grid"><TextField label="Fabricante" name="fabricante" value={form.fabricante} onChange={updateField} /><TextField label="Modelo" name="modelo" value={form.modelo} onChange={updateField} /></div>
            <TextField label="Número de serie" name="serie" value={form.serie} onChange={updateField} />
            <TextField label="Ubicación del equipo" name="ubicacionEquipo" value={form.ubicacionEquipo} onChange={updateField} />
          </>}

          {step === 4 && <>
            <TextField label="Descripción / diagnóstico" name="descripcion" value={form.descripcion} onChange={updateField} multiline />
            <TextField label="Tipo de falla" name="tipoFalla" value={form.tipoFalla} onChange={updateField} />
            <TextField label="Resultado / trabajo realizado" name="resultado" value={form.resultado} onChange={updateField} multiline />
            <TextField label="Pruebas realizadas" name="pruebasRealizadas" value={form.pruebasRealizadas} onChange={updateField} multiline />
            <TextField label="Recomendaciones" name="recomendaciones" value={form.recomendaciones} onChange={updateField} multiline />
            <TextField label="Supervisor" name="supervisor" value={form.supervisor} onChange={updateField} />
          </>}

          {step === 5 && <div className="ticket-evidence-step">
            <label className="ticket-camera-button"><input type="file" accept="image/*" capture="environment" multiple onChange={addImages} /><Icon name="camera" /><strong>Tomar foto o seleccionar archivos</strong></label>
            <div className="ticket-evidence-grid">
              {images.map((image, index) => <article key={`${image.name}-${index}`}><img src={image.url} alt={image.name} /><button type="button" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Icon name="delete" /></button><span>{image.name}</span></article>)}
              <label className="ticket-evidence-add"><input type="file" accept="image/*" multiple onChange={addImages} /><Icon name="add_a_photo" /><span>Añadir otra</span></label>
            </div>
          </div>}

          {step === 6 && <>
            <TextField label="Nombre de quien firma" name="firmaNombre" value={form.firmaNombre} onChange={updateField} />
            <SignaturePad value={form.firma} onChange={(firma) => setForm((current) => ({ ...current, firma }))} />
          </>}

          {step === 7 && <div className="ticket-review-list">
            {[
              ['Título', form.titulo], ['Categoría', form.categoria], ['Fecha', form.fecha], ['Cliente', form.cliente],
              ['Ubicación', form.ubicacion], ['Equipo', [form.fabricante, form.modelo, form.serie].filter(Boolean).join(' · ')],
              ['Resultado', form.resultado], ['Evidencias nuevas', `${images.length} archivo(s)`], ['Firma', form.firmaNombre],
            ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || 'Sin especificar'}</strong></div>)}
          </div>}
        </div>
      </section>

      <div className="ticket-form-actions">
        <button className="button button--secondary" type="button" onClick={() => step ? setStep((current) => current - 1) : navigate(editing ? `/boletas/${encodeURIComponent(boletaId)}` : '/')}><Icon name={step ? 'chevron_left' : 'close'} /> {step ? 'Anterior' : 'Cancelar'}</button>
        {step < steps.length - 1 ? (
          <button className="button button--primary" type="button" onClick={nextStep}>Siguiente <Icon name="chevron_right" /></button>
        ) : (
          <button className="button button--primary" type="button" onClick={saveTicket} disabled={saving}><Icon name="task_alt" /> {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear boleta'}</button>
        )}
      </div>
    </div>
  );
}
