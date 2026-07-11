import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { TicketStatusChip } from '../../components/tickets/TicketCard';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { formatDate, getEvidenceList, normalizeTicketStatus } from '../../utils/tickets';

function DetailSection({ title, icon, children, open = false }) {
  return (
    <details className="ticket-detail-section" open={open}>
      <summary>
        <span className="section-marker" />
        {icon && <Icon name={icon} />}
        <strong>{title}</strong>
        <Icon name="expand_more" />
      </summary>
      <div className="ticket-detail-section__content">{children}</div>
    </details>
  );
}

function InfoGrid({ items }) {
  return (
    <dl className="ticket-info-grid">
      {items.map(([label, value, wide]) => (
        <div className={wide ? 'is-wide' : ''} key={label}>
          <dt>{label}</dt>
          <dd>{value || 'Sin especificar'}</dd>
        </div>
      ))}
    </dl>
  );
}

function evidenceSource(item) {
  if (typeof item === 'string') return item;
  return pick(item, ['url', 'Url', 'URL', 'Imagen', 'image', 'Archivo', 'DataUrl']);
}

export default function TicketDetailPage() {
  const { boletaId } = useParams();
  const { sessionToken } = useAuth();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  async function loadTicket() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.tickets.get, {
        boletaId,
        ticketId: boletaId,
        id: boletaId,
      }, sessionToken);
      setTicket(data?.boleta || data?.ticket || data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTicket();
  }, [boletaId, sessionToken]);

  async function finalizeTicket() {
    if (!window.confirm('¿Desea finalizar esta boleta?')) return;
    setFinalizing(true);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.tickets.finalize, {
        boletaId,
        ticketId: boletaId,
        id: boletaId,
        estado: 'FINALIZADA',
        Estado: 'FINALIZADA',
      }, sessionToken);
      await loadTicket();
    } catch (err) {
      setError(err.message);
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boleta...</span></div></div>;
  }

  const record = ticket || {};
  const status = normalizeTicketStatus(record);
  const evidence = getEvidenceList(record);
  const pdfUrl = pick(record, ['PDF_Url', 'PdfUrl', 'PDFUrl', 'pdfUrl']);
  const signature = pick(record, ['Firma', 'FirmaUrl', 'Firma_Url', 'signature']);
  const backTo = status === 'FINALIZADA' ? '/boletas/finalizadas' : '/boletas/pendientes';

  return (
    <div className="page page--narrow ticket-detail-page">
      <div className="page-header">
        <button className="icon-button" type="button" onClick={() => navigate(backTo)} aria-label="Volver"><Icon name="arrow_back" /></button>
        <div>
          <span className="eyebrow">Detalle de servicio</span>
          <h1>Boleta #{String(boletaId).slice(0, 20)}</h1>
        </div>
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      <section className="ticket-status-card">
        <div><span>Estado actual</span><TicketStatusChip status={status} /></div>
        <div><span>Fecha de asignación</span><strong>{formatDate(pick(record, ['Fecha', 'FechaCreacion', 'CreatedAt']))}</strong></div>
      </section>

      <DetailSection title="Información general" icon="description" open>
        <InfoGrid items={[
          ['Título', pick(record, ['Titulo', 'Título', 'TituloBoleta']), true],
          ['Categoría', pick(record, ['Categoria', 'Categoría', 'TipoServicio'])],
          ['Tipo de falla', pick(record, ['TipoFalla', 'Tipo de falla'])],
          ['Razón de visita', pick(record, ['Razon_visita', 'RazonVisita']), true],
          ['Descripción', pick(record, ['Descripcion', 'Descripción']), true],
        ]} />
      </DetailSection>

      <DetailSection title="Cliente" icon="corporate_fare">
        <InfoGrid items={[
          ['Cliente', pick(record, ['Cliente', 'ClienteNombre', 'Clientes']), true],
          ['Contacto', pick(record, ['Contacto', 'ContactoCliente'])],
          ['Correo', pick(record, ['Correo_Cliente', 'CorreoCliente', 'Correo'])],
          ['Ubicación', pick(record, ['Ubicacion', 'Ubicación', 'Direccion']), true],
        ]} />
      </DetailSection>

      <DetailSection title="Dispositivo / equipo" icon="devices_other">
        <InfoGrid items={[
          ['Fabricante', pick(record, ['Fabricante', 'Marca'])],
          ['Modelo', pick(record, ['Modelo'])],
          ['Número de serie', pick(record, ['Serie', 'NumeroSerie'])],
          ['Ubicación del equipo', pick(record, ['Ubicacion_equipo', 'UbicacionEquipo']), true],
        ]} />
      </DetailSection>

      <DetailSection title="Trabajo realizado" icon="engineering">
        <InfoGrid items={[
          ['Resultado', pick(record, ['Resultado', 'TrabajoRealizado']), true],
          ['Pruebas realizadas', pick(record, ['Pruebas_realizadas', 'PruebasRealizadas']), true],
          ['Recomendaciones', pick(record, ['Recomendaciones']), true],
          ['Supervisor', pick(record, ['Supervisor'])],
          ['Horas totales', pick(record, ['HorasTotales'], '0')],
        ]} />
      </DetailSection>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">Archivos</span><h2>Evidencias fotográficas</h2></div></div>
        {evidence.length ? (
          <div className="evidence-gallery">
            {evidence.map((item, index) => {
              const source = evidenceSource(item);
              if (!source) return null;
              return (
                <a href={source} target="_blank" rel="noreferrer" className="evidence-gallery__item" key={`${source}-${index}`}>
                  <img src={source} alt={`Evidencia ${index + 1}`} />
                  <span>Evidencia {index + 1}</span>
                </a>
              );
            })}
          </div>
        ) : <div className="empty-state"><Icon name="photo_library" /><h2>Sin evidencias</h2><p>No hay fotografías asociadas a esta boleta.</p></div>}
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">Conformidad</span><h2>Firma del cliente</h2></div></div>
        <div className="signature-display">
          {signature ? <img src={signature} alt="Firma del cliente" /> : <span><Icon name="draw" /> Firma pendiente</span>}
        </div>
      </section>

      <div className="ticket-detail-actions">
        <Link className="button button--secondary" to={`/boletas/${encodeURIComponent(boletaId)}/editar`}><Icon name="edit" /> Editar</Link>
        {pdfUrl ? <a className="button button--secondary" href={pdfUrl} target="_blank" rel="noreferrer"><Icon name="picture_as_pdf" /> PDF</a> : <button className="button button--secondary" type="button" disabled><Icon name="picture_as_pdf" /> PDF</button>}
        {status !== 'FINALIZADA' && (
          <button className="button button--primary button--wide" type="button" onClick={finalizeTicket} disabled={finalizing}>
            <Icon name="task_alt" /> {finalizing ? 'Finalizando...' : 'Finalizar boleta'}
          </button>
        )}
      </div>
    </div>
  );
}
