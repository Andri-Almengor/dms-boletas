import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import BoletasApp from './Boletas';
import { apiRequest } from './api';
import { useAuth } from './AuthContext';

function ErrorMessage({ message }) {
  return message ? <p role="alert">Error: {message}</p> : null;
}

function MediaPreview({ boletaUid, fileId, mimeType, alt }) {
  const { sessionToken } = useAuth();
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!fileId) return undefined;

    apiRequest('boletas.media.get', { boletaUid, fileId }, sessionToken)
      .then((result) => {
        if (active) setDataUrl(result.dataUrl || '');
      })
      .catch((err) => active && setError(err.message));

    return () => { active = false; };
  }, [boletaUid, fileId, sessionToken]);

  if (error) return <p>No se pudo cargar la imagen: {error}</p>;
  if (!dataUrl) return <p>Cargando imagen...</p>;

  if (String(mimeType || '').startsWith('image/') || dataUrl.startsWith('data:image/')) {
    return (
      <img
        src={dataUrl}
        alt={alt || 'Imagen'}
        style={{ display: 'block', maxWidth: '100%', maxHeight: '520px', objectFit: 'contain', border: '1px solid #ccc' }}
      />
    );
  }

  return <a href={dataUrl} download>Descargar archivo</a>;
}

function EnhancedBoletaDetail({ boletaUid }) {
  const { sessionToken, hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [evidenceName, setEvidenceName] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);

  async function load() {
    try {
      const result = await apiRequest('boletas.get', { boletaUid }, sessionToken);
      setData(result);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [boletaUid, sessionToken]);

  async function finalize(testMode) {
    const message = testMode
      ? '¿Generar PDF y enviar únicamente al Chat y correo de prueba?'
      : '¿Finalizar la boleta, generar PDF y enviar correo y Google Chat?';
    if (!window.confirm(message)) return;

    setProcessing(true);
    setError('');
    try {
      if (testMode) {
        const result = await apiRequest('boletas.testFinalize', { boletaUid }, sessionToken);
        window.alert(`Prueba enviada correctamente.\nPDF: ${result.artifacts?.pdfUrl || 'generado'}`);
      } else {
        const result = await apiRequest('boletas.finalize', {
          boletaUid,
          testMode: false,
          sendClientCopy: Boolean(data.boleta.EnviarCorreoCliente),
          cc: data.boleta.CorreosCC || '',
        }, sessionToken);
        if (!result.notification?.ok) setError(result.notification?.error || 'La boleta se finalizó, pero ocurrió un error de notificación.');
        await load();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function returnToPending() {
    if (!window.confirm('¿Volver esta boleta a pendiente?')) return;
    setProcessing(true);
    try {
      await apiRequest('boletas.update', { boletaUid, estado: 'PENDIENTE' }, sessionToken);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function uploadEvidence(event) {
    event.preventDefault();
    if (!evidenceFile) return;
    try {
      const base64 = await fileToBase64(evidenceFile);
      await apiRequest('boletas.evidence.upload', {
        boletaUid,
        nombre: evidenceName || evidenceFile.name,
        nota: evidenceNote,
        fileName: evidenceFile.name,
        mimeType: evidenceFile.type || 'application/octet-stream',
        base64,
      }, sessionToken);
      setEvidenceName('');
      setEvidenceNote('');
      setEvidenceFile(null);
      event.target.reset();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function editEvidence(item) {
    const nombre = window.prompt('Nombre de la evidencia', item.Nombre || '');
    if (nombre === null) return;
    const nota = window.prompt('Nota', item.Nota || '');
    if (nota === null) return;
    try {
      await apiRequest('boletas.evidence.update', { evidenciaId: item.EvidenciaID, nombre, nota }, sessionToken);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteEvidence(item) {
    if (!window.confirm('¿Eliminar esta evidencia?')) return;
    try {
      await apiRequest('boletas.evidence.delete', { evidenciaId: item.EvidenciaID }, sessionToken);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <main><ErrorMessage message={error} /><p>Cargando...</p></main>;
  const boleta = data.boleta;
  const canEditEvidence = hasPermission('BOLETAS_EVIDENCIAS');

  return (
    <main>
      <header>
        <strong>Boletas</strong>{' | '}
        <Link to="/">Home</Link>{' | '}
        <Link to="/boletas/pendientes">Pendientes</Link>{' | '}
        <Link to="/boletas/finalizadas">Finalizadas</Link>
      </header>
      <hr />

      <h1>Boleta {boleta.BoletaID}: {boleta.Titulo}</h1>
      <ErrorMessage message={error} />
      <p><strong>Estado:</strong> {boleta.Estado}</p>
      <p><strong>Fecha:</strong> {boleta.Fecha ? new Date(boleta.Fecha).toLocaleDateString() : ''}</p>
      <p><strong>Cliente:</strong> {boleta.Cliente}</p>
      <p><strong>Ubicación:</strong> {boleta.Ubicacion}</p>
      <p><strong>Ubicación del equipo:</strong> {boleta.UbicacionEquipo}</p>
      <p><strong>Supervisor:</strong> {boleta.Supervisor}</p>
      <p><strong>Correo del supervisor:</strong> {boleta.CorreoSupervisor}</p>
      <p><strong>Asignados:</strong> {(data.asignados || []).map((item) => item.NombreCompleto).join(', ')}</p>
      <p><strong>Categoría:</strong> {boleta.Categoria}</p>
      <p><strong>Dispositivo:</strong> {[boleta.TipoDispositivo, boleta.Fabricante, boleta.Modelo].filter(Boolean).join(' - ')}</p>
      <p><strong>Tipo de falla:</strong> {boleta.TipoFalla}</p>
      <p><strong>Serie:</strong> {boleta.Serie}</p>
      <p><strong>Razón de visita:</strong> {boleta.RazonVisita}</p>
      <p><strong>Descripción:</strong> {boleta.Descripcion}</p>
      <p><strong>Pruebas realizadas:</strong> {boleta.PruebasRealizadas}</p>
      <p><strong>Resultado:</strong> {boleta.Resultado}</p>
      <p><strong>Recomendaciones:</strong> {boleta.Recomendaciones}</p>

      <section>
        <h2>Firma</h2>
        {boleta.FirmaArchivoID ? (
          <MediaPreview boletaUid={boletaUid} fileId={boleta.FirmaArchivoID} mimeType="image/png" alt="Firma de la boleta" />
        ) : <p>Sin firma.</p>}
      </section>

      {boleta.DocumentoURL && <p><strong>Documento:</strong> <a href={boleta.DocumentoURL} target="_blank" rel="noreferrer">Abrir documento</a></p>}
      {boleta.PDFURL && <p><strong>PDF:</strong> <a href={boleta.PDFURL} target="_blank" rel="noreferrer">Abrir PDF</a></p>}
      {boleta.CarpetaURL && <p><strong>Carpeta:</strong> <a href={boleta.CarpetaURL} target="_blank" rel="noreferrer">Abrir carpeta</a></p>}

      {hasPermission('BOLETAS_EDITAR') && (
        <p>
          <Link to={`/boletas/${boletaUid}/editar`}>Editar boleta</Link>{' | '}
          {boleta.Estado !== 'FINALIZADO' ? (
            <>
              <button type="button" disabled={processing} onClick={() => finalize(false)}>{processing ? 'Procesando...' : 'Finalizar, generar PDF y enviar'}</button>
              {hasPermission('NOTIFICACIONES_PRUEBA') && <>{' | '}<button type="button" disabled={processing} onClick={() => finalize(true)}>Probar PDF, Chat y correo</button></>}
            </>
          ) : <button type="button" disabled={processing} onClick={returnToPending}>Volver a pendiente</button>}
        </p>
      )}

      <section>
        <h2>Evidencias</h2>
        {(data.evidencias || []).length === 0 ? <p>No hay evidencias.</p> : (
          <div>
            {(data.evidencias || []).map((evidence) => (
              <article key={evidence.EvidenciaID} style={{ border: '1px solid #ccc', padding: '12px', marginBottom: '16px' }}>
                <h3>{evidence.Nombre}</h3>
                {evidence.Nota && <p>{evidence.Nota}</p>}
                {String(evidence.MimeType || '').startsWith('image/') ? (
                  <MediaPreview boletaUid={boletaUid} fileId={evidence.ArchivoID} mimeType={evidence.MimeType} alt={evidence.Nombre} />
                ) : <a href={evidence.ArchivoURL} target="_blank" rel="noreferrer">Abrir archivo</a>}
                {canEditEvidence && <p><button type="button" onClick={() => editEvidence(evidence)}>Editar</button>{' '}<button type="button" onClick={() => deleteEvidence(evidence)}>Eliminar</button></p>}
              </article>
            ))}
          </div>
        )}

        {canEditEvidence && (
          <form onSubmit={uploadEvidence}>
            <div><label>Nombre<br /><input value={evidenceName} onChange={(event) => setEvidenceName(event.target.value)} /></label></div>
            <div><label>Nota<br /><textarea value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} /></label></div>
            <div><label>Archivo<br /><input type="file" accept="image/*,.pdf" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} required /></label></div>
            <button>Agregar evidencia</button>
          </form>
        )}
      </section>

      <p><Link to={boleta.Estado === 'FINALIZADO' ? '/boletas/finalizadas' : '/boletas/pendientes'}>Volver</Link></p>
    </main>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BoletasEnhanced() {
  const location = useLocation();
  const match = location.pathname.match(/^\/boletas\/([^/]+)$/);
  if (match && !['pendientes', 'finalizadas', 'nueva'].includes(match[1])) {
    return <EnhancedBoletaDetail boletaUid={match[1]} />;
  }
  return <BoletasApp />;
}
