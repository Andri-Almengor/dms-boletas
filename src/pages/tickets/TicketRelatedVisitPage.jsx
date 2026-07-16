import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import EvidenceUploader from '../../components/forms/EvidenceUploader';
import TechnicianMultiSelect from '../../components/forms/TechnicianMultiSelect';
import SignaturePad from '../../components/tickets/SignaturePad';
import TechnicalWritingAssistant from '../../components/tickets/TechnicalWritingAssistant';
import { createOfflineId } from '../../services/offlineStore';
import {
  MODULE_ROUTES,
  normalizeItems,
  pick,
  requestAvailable,
} from '../../services/moduleApi';
import { todayInCostaRica } from '../../utils/costaRicaDate';
import { formatCeilingTotalHours } from '../../utils/ticketHours';

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function optionRows(rows, idKeys, labelKeys) {
  return rows.map((row) => {
    const value = text(pick(row, idKeys));
    const label = text(pick(row, labelKeys));
    return value && label ? { value, label, row } : null;
  }).filter(Boolean);
}

function resolveCatalogSelection(rows, currentId, currentLabel, idKeys, labelKeys) {
  const byId = rows.find((row) => idKeys.some((key) => text(row?.[key]) === text(currentId)));
  if (byId) {
    return {
      id: text(pick(byId, idKeys)),
      label: text(pick(byId, labelKeys, currentLabel)),
    };
  }
  const wanted = normalized(currentLabel);
  if (!wanted) return { id: text(currentId), label: text(currentLabel) };
  const byName = rows.find((row) => labelKeys.some((key) => normalized(row?.[key]) === wanted));
  return byName
    ? { id: text(pick(byName, idKeys)), label: text(pick(byName, labelKeys, currentLabel)) }
    : { id: text(currentId), label: text(currentLabel) };
}

function ticketRecord(bundle) {
  return bundle?.boleta || bundle || {};
}

function selectedTechnicians(bundle) {
  return (bundle?.asignados || [])
    .map((item) => text(pick(item, ['UsuarioID', 'value'], item)))
    .filter(Boolean);
}

function hasSignature(ticket) {
  return Boolean(text(pick(ticket, ['FirmaArchivoID', 'FirmaFileID', 'FirmaURL', 'FirmaUrl', 'Firma'])));
}

function buildInitialForm(bundle, catalogs = {}) {
  const row = ticketRecord(bundle);
  const failure = resolveCatalogSelection(
    catalogs.failures || [],
    pick(row, ['TipoFallaID']),
    pick(row, ['TipoFalla']),
    ['TipoFallaID', 'ID', 'id'],
    ['Nombre'],
  );
  const device = resolveCatalogSelection(
    catalogs.devices || [],
    pick(row, ['TipoDispositivoID']),
    pick(row, ['TipoDispositivo']),
    ['TipoDispositivoID', 'ID', 'id'],
    ['Nombre'],
  );
  const manufacturer = resolveCatalogSelection(
    catalogs.manufacturers || [],
    pick(row, ['FabricanteID']),
    pick(row, ['Fabricante']),
    ['FabricanteID', 'ID', 'id'],
    ['Nombre'],
  );
  const model = resolveCatalogSelection(
    catalogs.models || [],
    pick(row, ['ModeloID']),
    pick(row, ['Modelo']),
    ['ModeloID', 'ID', 'id'],
    ['Nombre'],
  );

  return {
    tipoFallaId: failure.id,
    tipoFalla: failure.label,
    fecha: todayInCostaRica(),
    horaInicio: '',
    horaFinal: '',
    horasTotales: '0.00',
    ubicacionId: text(pick(row, ['UbicacionID'])),
    ubicacion: pick(row, ['Ubicacion', 'Ubicación']),
    ubicacionEquipoId: text(pick(row, ['UbicacionEquipoID'])),
    ubicacionEquipo: pick(row, ['UbicacionEquipo', 'Ubicacion_equipo']),
    nombreDispositivo: pick(row, ['Descripcion', 'Descripción', 'DescripcionEquipo', 'NombreEquipo']),
    tipoDispositivoId: device.id,
    tipoDispositivo: device.label,
    fabricanteId: manufacturer.id,
    fabricante: manufacturer.label,
    modeloId: model.id,
    modelo: model.label,
    razonVisita: '',
    pruebasRealizadas: '',
    resultado: '',
    recomendaciones: '',
    asignados: selectedTechnicians(bundle),
  };
}

function Field({ label, multiline = false, hint = '', ...props }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea className="form-control ticket-textarea" rows="4" {...props} />
        : <input className="form-control" {...props} />}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function Select({ label, value, onChange, options, emptyLabel = 'Seleccione una opción' }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      <select className="form-control" value={value} onChange={onChange}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function TicketRelatedVisitPage() {
  const { boletaUid } = useParams();
  const navigate = useNavigate();
  const { sessionToken } = useAuth();
  const [parentBundle, setParentBundle] = useState(null);
  const [form, setForm] = useState(null);
  const [catalogs, setCatalogs] = useState({ failures: [], devices: [], manufacturers: [], models: [], users: [] });
  const [signature, setSignature] = useState('');
  const [evidences, setEvidences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      requestAvailable(MODULE_ROUTES.tickets.get, { boletaUid, id: boletaUid }, sessionToken),
      Promise.allSettled([
        requestAvailable(MODULE_ROUTES.failureTypes.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.manufacturers.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.models.list, { page: 1, pageSize: 1500, activo: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.users.list, { page: 1, pageSize: 1000 }, sessionToken),
      ]),
    ]).then(([bundle, results]) => {
      if (!active) return;
      const keys = ['failures', 'devices', 'manufacturers', 'models', 'users'];
      const nextCatalogs = {};
      results.forEach((result, index) => {
        nextCatalogs[keys[index]] = result.status === 'fulfilled' ? normalizeItems(result.value) : [];
      });
      setCatalogs(nextCatalogs);
      setParentBundle(bundle);
      setForm(buildInitialForm(bundle, nextCatalogs));
    }).catch((loadError) => {
      if (active) setError(loadError.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [boletaUid, sessionToken]);

  useEffect(() => {
    if (!form) return;
    const total = formatCeilingTotalHours(form.horaInicio, form.horaFinal);
    if (total !== form.horasTotales) {
      setForm((current) => ({ ...current, horasTotales: total }));
    }
  }, [form?.horaInicio, form?.horaFinal]);

  const options = useMemo(() => ({
    failures: optionRows(catalogs.failures, ['TipoFallaID', 'id'], ['Nombre']),
    devices: optionRows(catalogs.devices, ['TipoDispositivoID', 'id'], ['Nombre']),
    manufacturers: optionRows(catalogs.manufacturers, ['FabricanteID', 'id'], ['Nombre']),
    models: optionRows(
      catalogs.models.filter((item) => (
        (!form?.tipoDispositivoId || text(item.TipoDispositivoID) === text(form.tipoDispositivoId))
        && (!form?.fabricanteId || text(item.FabricanteID) === text(form.fabricanteId))
      )),
      ['ModeloID', 'id'],
      ['Nombre'],
    ),
    technicians: catalogs.users.map((item) => {
      const label = pick(item, ['NombreCompleto', 'Nombre']);
      const parts = String(label || '').split(/\s+/);
      return {
        value: text(pick(item, ['UsuarioID', 'id'])),
        label,
        note: pick(item, ['Correo', 'NombreUsuario']),
        initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase(),
      };
    }).filter((item) => item.value && item.label),
  }), [catalogs, form?.tipoDispositivoId, form?.fabricanteId]);

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function choose(event, optionList, idField, labelField, reset = {}) {
    const selected = optionList.find((option) => option.value === event.target.value);
    setForm((current) => ({
      ...current,
      [idField]: event.target.value,
      [labelField]: selected?.label || '',
      ...reset,
    }));
  }

  function addEvidenceFiles(event) {
    const files = Array.from(event?.target?.files || event || []);
    if (!files.length) return;
    setEvidences((current) => [
      ...current,
      ...files.map((file) => ({
        localId: createOfflineId('archivo-visita'),
        file,
        name: file.name,
        note: '',
        mimeType: file.type || 'application/octet-stream',
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      })),
    ]);
    if (event?.target) event.target.value = '';
  }

  function updateEvidence(index, patch) {
    setEvidences((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function removeEvidence(index) {
    setEvidences((current) => {
      const removed = current[index];
      if (removed?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function save(event) {
    event.preventDefault();
    if (!form.fecha || !form.razonVisita || !form.resultado || !form.asignados.length) {
      setError('Fecha, razón de visita, resultado y al menos un técnico son obligatorios.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const parent = ticketRecord(parentBundle);
      const group = parentBundle?.grupoVisitas || {};
      const localId = createOfflineId('boleta');
      const createPayload = {
        boletaUid: localId,
        BoletaUID: localId,
        parentTicketId: boletaUid,
        GrupoVisitaID: group.id || parent.GrupoVisitaID || parent.BoletaUID,
        BoletaPrincipalUID: group.rootId || parent.BoletaPrincipalUID || parent.BoletaUID,
        NumeroVisita: Number(group.count || parentBundle?.visitasRelacionadas?.length || 1) + 1,
        EsVisitaPrincipal: false,
        Titulo: parent.Titulo,
        titulo: parent.Titulo,
        Estado: 'PENDIENTE',
        estado: 'PENDIENTE',
        ClienteID: parent.ClienteID,
        Cliente: parent.Cliente,
        clienteId: parent.ClienteID,
        cliente: parent.Cliente,
        CategoriaID: parent.CategoriaID,
        Categoria: parent.Categoria,
        categoriaId: parent.CategoriaID,
        categoria: parent.Categoria,
        SupervisorID: parent.SupervisorID,
        Supervisor: parent.Supervisor,
        supervisorId: parent.SupervisorID,
        supervisor: parent.Supervisor,
        CorreoSupervisor: parent.CorreoSupervisor,
        correoSupervisor: parent.CorreoSupervisor,
        CorreoCliente: parent.CorreoCliente,
        correoCliente: parent.CorreoCliente,
        EnviarCorreoCliente: parent.EnviarCorreoCliente,
        CorreosCC: parent.CorreosCC,
        TipoFallaID: form.tipoFallaId,
        TipoFalla: form.tipoFalla,
        tipoFallaId: form.tipoFallaId,
        tipoFalla: form.tipoFalla,
        Fecha: form.fecha,
        fecha: form.fecha,
        HoraInicio: form.horaInicio,
        horaInicio: form.horaInicio,
        HoraFinal: form.horaFinal,
        horaFinal: form.horaFinal,
        HorasTotales: Number(form.horasTotales || 0),
        horasTotales: Number(form.horasTotales || 0),
        UbicacionID: form.ubicacionId,
        Ubicacion: form.ubicacion,
        ubicacionId: form.ubicacionId,
        ubicacion: form.ubicacion,
        UbicacionEquipoID: form.ubicacionEquipoId,
        UbicacionEquipo: form.ubicacionEquipo,
        ubicacionEquipoId: form.ubicacionEquipoId,
        ubicacionEquipo: form.ubicacionEquipo,
        Descripcion: form.nombreDispositivo,
        descripcion: form.nombreDispositivo,
        TipoDispositivoID: form.tipoDispositivoId,
        TipoDispositivo: form.tipoDispositivo,
        tipoDispositivoId: form.tipoDispositivoId,
        tipoDispositivo: form.tipoDispositivo,
        FabricanteID: form.fabricanteId,
        Fabricante: form.fabricante,
        fabricanteId: form.fabricanteId,
        fabricante: form.fabricante,
        ModeloID: form.modeloId,
        Modelo: form.modelo,
        modeloId: form.modeloId,
        modelo: form.modelo,
        Serie: parent.Serie,
        RazonVisita: form.razonVisita,
        razonVisita: form.razonVisita,
        PruebasRealizadas: form.pruebasRealizadas,
        pruebasRealizadas: form.pruebasRealizadas,
        Resultado: form.resultado,
        resultado: form.resultado,
        Recomendaciones: form.recomendaciones,
        recomendaciones: form.recomendaciones,
        AsignadoA: form.asignados,
        asignados: form.asignados,
      };
      const created = await requestAvailable(MODULE_ROUTES.tickets.create, createPayload, sessionToken);
      const createdId = text(pick(created?.boleta || created, ['BoletaUID', 'boletaUid'], localId));

      for (const item of evidences) {
        await requestAvailable(MODULE_ROUTES.tickets.evidenceUpload, {
          boletaUid: createdId,
          BoletaUID: createdId,
          evidenciaId: createOfflineId('evidencia'),
          nombre: item.name || item.file.name,
          nota: item.note,
          fileName: item.file.name,
          mimeType: item.mimeType || item.file.type || 'application/octet-stream',
          base64: await fileToBase64(item.file),
        }, sessionToken);
      }

      if (signature.startsWith('data:image/')) {
        await requestAvailable(MODULE_ROUTES.tickets.signatureUpload, {
          boletaUid: createdId,
          BoletaUID: createdId,
          GrupoVisitaID: createPayload.GrupoVisitaID,
          BoletaPrincipalUID: createPayload.BoletaPrincipalUID,
          base64: signature.split(',')[1],
          mimeType: 'image/png',
          fileName: `firma_seguimiento_${createPayload.BoletaPrincipalUID}.png`,
        }, sessionToken);
      }

      navigate(`/boletas/${encodeURIComponent(createdId)}`, { replace: true });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="page page--narrow"><div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando visita anterior...</span></div></div>;
  }

  if (!form || !parentBundle) {
    return <div className="page page--narrow"><div className="alert alert--error"><Icon name="error" /><span>{error || 'No se encontró la boleta base.'}</span></div></div>;
  }

  const parent = ticketRecord(parentBundle);
  const parentSigned = hasSignature(parent);
  const nextVisit = Number(parentBundle?.grupoVisitas?.count || parentBundle?.visitasRelacionadas?.length || 1) + 1;
  const assistantForm = {
    ...form,
    titulo: parent.Titulo,
    cliente: parent.Cliente,
    categoria: parent.Categoria,
    serie: parent.Serie,
  };

  return (
    <form className="page page--narrow related-visit-page" onSubmit={save}>
      <header className="page-header">
        <Link to={`/boletas/${encodeURIComponent(boletaUid)}`} className="icon-button" aria-label="Volver"><Icon name="arrow_back" /></Link>
        <div><span className="eyebrow">Seguimiento de servicio</span><h1>Añadir visita {nextVisit}</h1><p>Boleta base #{parent.BoletaID || parent.BoletaUID} · {parent.Cliente}</p></div>
      </header>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
      <div className="info-box related-visit-inherited"><Icon name="link" /><p>Cliente, categoría, supervisor, correos y configuración general se copiarán automáticamente de la primera boleta. Después de guardar, esta visita también se puede editar con el formulario completo.</p></div>

      <section className="detail-card">
        <div className="detail-card__heading"><span className="section-marker" /><h2>Fecha, horario y falla</h2></div>
        <div className="form-grid form-grid--two">
          <Select label="Tipo de falla" value={form.tipoFallaId} options={options.failures} onChange={(event) => choose(event, options.failures, 'tipoFallaId', 'tipoFalla')} />
          <Field label="Fecha" name="fecha" type="date" value={form.fecha} onChange={update} required />
          <Field label="Hora inicio" name="horaInicio" type="time" value={form.horaInicio} onChange={update} required />
          <Field label="Hora final" name="horaFinal" type="time" value={form.horaFinal} onChange={update} required />
          <Field label="Horas totales" name="horasTotales" value={form.horasTotales} readOnly hint="Se calcula automáticamente redondeando hacia arriba." />
        </div>
      </section>

      <section className="detail-card">
        <div className="detail-card__heading"><span className="section-marker" /><h2>Ubicación y dispositivo</h2></div>
        <div className="form-grid form-grid--two">
          <Field label="Ubicación" name="ubicacion" value={form.ubicacion} onChange={update} />
          <Field label="Ubicación del equipo" name="ubicacionEquipo" value={form.ubicacionEquipo} onChange={update} />
          <Field label="Nombre del dispositivo" name="nombreDispositivo" value={form.nombreDispositivo} onChange={update} />
          <Select label="Tipo" value={form.tipoDispositivoId} options={options.devices} onChange={(event) => choose(event, options.devices, 'tipoDispositivoId', 'tipoDispositivo', { fabricanteId: '', fabricante: '', modeloId: '', modelo: '' })} />
          <Select label="Fabricante" value={form.fabricanteId} options={options.manufacturers} onChange={(event) => choose(event, options.manufacturers, 'fabricanteId', 'fabricante', { modeloId: '', modelo: '' })} />
          <Select label="Modelo" value={form.modeloId} options={options.models} onChange={(event) => choose(event, options.models, 'modeloId', 'modelo')} />
        </div>
      </section>

      <section className="detail-card">
        <div className="detail-card__heading"><span className="section-marker" /><h2>Trabajo realizado</h2></div>
        <TechnicalWritingAssistant form={assistantForm} setForm={setForm} disabled={saving} />
        <div className="form-grid">
          <Field label="Razón de visita" name="razonVisita" value={form.razonVisita} onChange={update} multiline required />
          <Field label="Pruebas realizadas" name="pruebasRealizadas" value={form.pruebasRealizadas} onChange={update} multiline />
          <Field label="Resultado" name="resultado" value={form.resultado} onChange={update} multiline required />
          <Field label="Recomendaciones" name="recomendaciones" value={form.recomendaciones} onChange={update} multiline />
        </div>
      </section>

      <section className="detail-card">
        <div className="detail-card__heading"><span className="section-marker" /><h2>Técnicos asignados</h2></div>
        <TechnicianMultiSelect users={options.technicians} selectedIds={form.asignados} onChange={(asignados) => setForm((current) => ({ ...current, asignados }))} disabled={saving} />
      </section>

      <section className="detail-card related-visit-evidence-card">
        <div className="detail-card__heading"><span className="section-marker" /><h2>Evidencias de esta visita</h2></div>
        <EvidenceUploader
          items={evidences}
          onAdd={addEvidenceFiles}
          onUpdate={updateEvidence}
          onRemove={removeEvidence}
          disabled={saving}
        />
      </section>

      <section className="detail-card">
        <div className="detail-card__heading"><span className="section-marker" /><h2>Firma del cliente</h2></div>
        {parentSigned ? (
          <div className="alert alert--success"><Icon name="verified" /><span>El seguimiento ya tiene firma. Se aplicará automáticamente a esta nueva visita.</span></div>
        ) : (
          <>
            <p className="muted">La firma es opcional en este momento. También puede compartir el enlace único desde el detalle de cualquiera de las visitas.</p>
            <SignaturePad value={signature} onChange={setSignature} />
          </>
        )}
      </section>

      <div className="form-actions form-actions--sticky">
        <Link className="button button--secondary" to={`/boletas/${encodeURIComponent(boletaUid)}`}>Cancelar</Link>
        <button className="button button--primary" type="submit" disabled={saving}><Icon name={saving ? 'progress_activity' : 'add_circle'} />{saving ? 'Guardando visita...' : 'Guardar visita relacionada'}</button>
      </div>
    </form>
  );
}
