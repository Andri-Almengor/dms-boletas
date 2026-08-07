import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import {
  getIntegrationGatewayOverview,
  provisionIntegrationGateway,
  revokeIntegrationGateway,
  sendIntegrationGatewayCommand,
} from '../../services/integrationGatewayApi';

const EMPTY_OVERVIEW = Object.freeze({
  gateways: [],
  devices: [],
  commands: [],
  summary: { gateways: 0, online: 0, devices: 0, pendingCommands: 0 },
});

function dateTime(value) {
  if (!value) return 'Sin contacto todavía';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function commandLabel(type) {
  if (type === 'PING') return 'Probar conexión';
  if (type === 'INVENTORY_SYNC') return 'Sincronizar inventario';
  return type;
}

function statusClass(value) {
  const normalized = String(value || '').toUpperCase();
  if (['COMPLETADO', 'ACTIVO', 'ONLINE'].includes(normalized)) return 'status-chip--active';
  if (['ERROR', 'REVOCADO', 'OFFLINE'].includes(normalized)) return 'status-chip--danger';
  return 'status-chip--pending';
}

export default function IntegrationsPage() {
  const { sessionToken } = useAuth();
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedCredential, setIssuedCredential] = useState(null);
  const [form, setForm] = useState({ name: '', clientId: '' });

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [gatewayData, clientData] = await Promise.all([
        getIntegrationGatewayOverview(sessionToken),
        clients.length
          ? Promise.resolve(null)
          : requestAvailable(
            MODULE_ROUTES.clients.list,
            { page: 1, pageSize: 500, activo: true, sortBy: 'Nombre', sortDir: 'asc' },
            sessionToken,
          ).catch(() => null),
      ]);
      setOverview(gatewayData || EMPTY_OVERVIEW);
      if (clientData) setClients(normalizeItems(clientData));
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el estado de las integraciones.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    load();
    const timer = window.setInterval(() => {
      if (active && document.visibilityState === 'visible') load({ silent: true });
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  const clientOptions = useMemo(() => clients.map((row) => ({
    value: String(pick(row, ['ClienteID', 'id'])),
    label: String(pick(row, ['Nombre', 'Clientes'], 'Cliente sin nombre')),
  })).filter((item) => item.value), [clients]);

  const devicesByGateway = useMemo(() => overview.devices.reduce((map, device) => {
    const gatewayId = String(device.GatewayID || '');
    if (!map.has(gatewayId)) map.set(gatewayId, []);
    map.get(gatewayId).push(device);
    return map;
  }, new Map()), [overview.devices]);

  async function provision(event) {
    event.preventDefault();
    if (working) return;
    const name = form.name.trim();
    if (!name) {
      setError('Escriba un nombre para el gateway.');
      return;
    }
    const selectedClient = clientOptions.find((item) => item.value === form.clientId);
    setWorking('provision');
    setError('');
    setNotice('');
    setIssuedCredential(null);
    try {
      const result = await provisionIntegrationGateway({
        name,
        clientId: selectedClient?.value || '',
        clientName: selectedClient?.label || '',
      }, sessionToken);
      setIssuedCredential({
        gatewayId: result.gateway.GatewayID,
        token: result.token,
        name: result.gateway.Nombre,
      });
      setForm({ name: '', clientId: '' });
      setNotice('Gateway creado. Copie sus credenciales ahora; el token no volverá a mostrarse.');
      await load({ silent: true });
    } catch (provisionError) {
      setError(provisionError.message || 'No se pudo crear el gateway.');
    } finally {
      setWorking('');
    }
  }

  async function copyCredential(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copiado al portapapeles.`);
    } catch {
      setError(`No se pudo copiar ${label.toLowerCase()}. Selecciónelo manualmente.`);
    }
  }

  async function sendCommand(gatewayId, type) {
    if (working) return;
    setWorking(`${gatewayId}:${type}`);
    setError('');
    setNotice('');
    try {
      const command = await sendIntegrationGatewayCommand(gatewayId, type, sessionToken);
      setNotice(`${commandLabel(type)} enviado. Estado actual: ${command.Estado}.`);
      await load({ silent: true });
    } catch (commandError) {
      setError(commandError.message || 'No se pudo enviar el comando.');
    } finally {
      setWorking('');
    }
  }

  async function revoke(gateway) {
    if (working || !window.confirm(`¿Revocar el gateway “${gateway.Nombre}”? El agente dejará de autenticarse inmediatamente.`)) return;
    setWorking(`${gateway.GatewayID}:revoke`);
    setError('');
    setNotice('');
    try {
      await revokeIntegrationGateway(gateway.GatewayID, sessionToken);
      setNotice('Gateway revocado correctamente.');
      await load({ silent: true });
    } catch (revokeError) {
      setError(revokeError.message || 'No se pudo revocar el gateway.');
    } finally {
      setWorking('');
    }
  }

  return <div className="page admin-module-page integration-gateway-page">
    <div className="list-page-heading integration-gateway-heading">
      <div>
        <Link to="/mas" className="back-link"><Icon name="arrow_back" /> Más opciones</Link>
        <span className="eyebrow">INFRAESTRUCTURA LOCAL</span>
        <h1>Gateways de integración</h1>
        <p>Base segura para conectar redes privadas con Render sin publicar cámaras, NVR ni sistemas internos.</p>
      </div>
      <button type="button" className="button button--secondary" onClick={() => load()} disabled={loading || Boolean(working)}>
        <Icon name={loading ? 'progress_activity' : 'refresh'} /> Actualizar
      </button>
    </div>

    <div className="info-box integration-foundation-note">
      <Icon name="hub" />
      <div><strong>Primera fase: infraestructura y simulación</strong><p>El agente ya puede autenticarse, enviar heartbeat, sincronizar inventario simulado y recibir comandos. Milestone, OnGuard y cámaras reales se incorporarán mediante adaptadores posteriores.</p></div>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}

    {issuedCredential && <section className="integration-credential-card" aria-live="polite">
      <div className="integration-credential-card__heading"><Icon name="key" /><div><h2>Credenciales del agente</h2><p>Se muestran una sola vez. Guárdelas en el servicio local, nunca en una boleta o documento compartido.</p></div></div>
      <label><span>Gateway ID</span><div><code>{issuedCredential.gatewayId}</code><button type="button" className="icon-button" onClick={() => copyCredential(issuedCredential.gatewayId, 'Gateway ID')} aria-label="Copiar Gateway ID"><Icon name="content_copy" /></button></div></label>
      <label><span>Token</span><div><code>{issuedCredential.token}</code><button type="button" className="icon-button" onClick={() => copyCredential(issuedCredential.token, 'Token')} aria-label="Copiar token"><Icon name="content_copy" /></button></div></label>
      <button type="button" className="button button--secondary" onClick={() => setIssuedCredential(null)}><Icon name="visibility_off" /> Ocultar token</button>
    </section>}

    <section className="form-card integration-provision-card">
      <div className="form-card__heading"><span className="section-marker" /><div><h2>Crear gateway</h2><p>Genere la identidad del equipo que permanecerá dentro de la red del cliente.</p></div></div>
      <form className="integration-provision-form" onSubmit={provision}>
        <label className="field-group"><span className="field-label">Nombre del gateway</span><input className="form-control" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Sede principal - servidor de monitoreo" maxLength={160} /></label>
        <label className="field-group"><span className="field-label">Cliente relacionado</span><select className="form-control" value={form.clientId} onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}><option value="">Sin cliente por ahora</option>{clientOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <button type="submit" className="button button--primary" disabled={Boolean(working)}><Icon name={working === 'provision' ? 'progress_activity' : 'add_link'} />{working === 'provision' ? 'Creando...' : 'Crear gateway'}</button>
      </form>
    </section>

    <section className="integration-summary-grid" aria-label="Resumen de gateways">
      <article><Icon name="dns" /><div><strong>{overview.summary.gateways}</strong><span>gateways</span></div></article>
      <article><Icon name="cloud_done" /><div><strong>{overview.summary.online}</strong><span>en línea</span></div></article>
      <article><Icon name="videocam" /><div><strong>{overview.summary.devices}</strong><span>dispositivos</span></div></article>
      <article><Icon name="pending_actions" /><div><strong>{overview.summary.pendingCommands}</strong><span>comandos pendientes</span></div></article>
    </section>

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando gateways...</div> : overview.gateways.length ? <div className="integration-gateway-grid">
      {overview.gateways.map((gateway) => {
        const devices = devicesByGateway.get(String(gateway.GatewayID)) || [];
        const active = String(gateway.Estado || '').toUpperCase() === 'ACTIVO';
        return <article className="integration-gateway-card" key={gateway.GatewayID}>
          <header><span className="integration-gateway-card__icon"><Icon name="router" /></span><div><h2>{gateway.Nombre}</h2><p>{gateway.Cliente || 'Sin cliente relacionado'}</p></div><span className={`status-chip ${gateway.online && active ? 'status-chip--active' : active ? 'status-chip--pending' : 'status-chip--danger'}`}>{!active ? 'REVOCADO' : gateway.online ? 'EN LÍNEA' : 'SIN CONEXIÓN'}</span></header>
          <dl>
            <div><dt>Gateway ID</dt><dd>{gateway.GatewayID}</dd></div>
            <div><dt>Último contacto</dt><dd>{dateTime(gateway.UltimoContacto)}</dd></div>
            <div><dt>Equipo</dt><dd>{gateway.Hostname || 'No informado'}</dd></div>
            <div><dt>Agente</dt><dd>{gateway.VersionAgente || 'No conectado'} · {gateway.Adaptador || 'SIMULATED'}</dd></div>
            <div><dt>Inventario</dt><dd>{devices.length} dispositivo{devices.length === 1 ? '' : 's'}</dd></div>
          </dl>
          {active && <div className="integration-gateway-card__actions">
            <button type="button" className="button button--secondary" disabled={Boolean(working)} onClick={() => sendCommand(gateway.GatewayID, 'PING')}><Icon name="network_ping" /> Probar conexión</button>
            <button type="button" className="button button--primary" disabled={Boolean(working)} onClick={() => sendCommand(gateway.GatewayID, 'INVENTORY_SYNC')}><Icon name="sync" /> Sincronizar inventario</button>
            <button type="button" className="button button--danger" disabled={Boolean(working)} onClick={() => revoke(gateway)}><Icon name="link_off" /> Revocar</button>
          </div>}
          {devices.length > 0 && <div className="integration-device-list"><h3>Dispositivos detectados</h3>{devices.slice(0, 12).map((device) => <div className="integration-device-row" key={device.DispositivoIntegracionID}><span className="integration-device-row__icon"><Icon name={device.Tipo === 'CAMERA' ? 'videocam' : 'memory'} /></span><div><strong>{device.NombreOperativo || device.NombreDetectado}</strong><small>{[device.SourceSystem, device.Fabricante, device.Modelo, device.DireccionIP].filter(Boolean).join(' · ')}</small></div><span className={`status-chip ${statusClass(device.EstadoConexion)}`}>{device.EstadoConexion || 'UNKNOWN'}</span></div>)}</div>}
        </article>;
      })}
    </div> : <div className="empty-state"><Icon name="router" /><h2>No hay gateways configurados</h2><p>Cree el primero para preparar una conexión saliente desde una red de pruebas.</p></div>}

    {overview.commands.length > 0 && <section className="form-card integration-command-history">
      <div className="form-card__heading"><span className="section-marker" /><div><h2>Comandos recientes</h2><p>Seguimiento de pruebas de conexión y solicitudes de inventario.</p></div></div>
      <div className="integration-command-list">{overview.commands.slice(0, 20).map((command) => <div key={command.ComandoID}><span className={`status-chip ${statusClass(command.Estado)}`}>{command.Estado}</span><strong>{commandLabel(command.Tipo)}</strong><small>{dateTime(command.FechaCreacion)} · {command.GatewayID}</small>{command.ErrorMensaje && <em>{command.ErrorMensaje}</em>}</div>)}</div>
    </section>}
  </div>;
}
