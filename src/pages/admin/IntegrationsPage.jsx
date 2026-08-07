import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import { fetchClientRelations } from '../../services/clientRelations';
import {
  getIntegrationGatewayOverview,
  provisionIntegrationGateway,
  revealIntegrationGatewayToken,
  revokeIntegrationGateway,
  sendIntegrationGatewayCommand,
  updateIntegrationDeviceProfile,
} from '../../services/integrationGatewayApi';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

const EMPTY_OVERVIEW = Object.freeze({
  gateways: [],
  devices: [],
  commands: [],
  summary: { gateways: 0, online: 0, devices: 0, pendingCommands: 0 },
});
const PAGE_SIZES = [25, 50, 100];

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dateTime(value) {
  if (!value) return 'Sin contacto todavía';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function commandLabel(type) {
  if (type === 'PING') return 'Probar conexión';
  if (type === 'INVENTORY_SYNC') return 'Sincronizar inventario';
  return type;
}

function statusClass(value) {
  const status = String(value || '').toUpperCase();
  if (['COMPLETADO', 'ACTIVO', 'ONLINE'].includes(status)) return 'status-chip--active';
  if (['ERROR', 'REVOCADO', 'OFFLINE', 'DISABLED', 'NO DETECTADO'].includes(status)) return 'status-chip--danger';
  return 'status-chip--pending';
}

function detectedInLatestSync(device) {
  const value = device?.DetectadoEnUltimaSincronizacion;
  return value !== false && String(value ?? 'true').toLowerCase() !== 'false';
}

function deviceStatus(device) {
  if (!detectedInLatestSync(device)) return 'NO DETECTADO';
  return String(device?.EstadoConexion || 'UNKNOWN').toUpperCase();
}

function displayName(device) {
  return device?.NombreOperativo || device?.NombreDetectado || 'Dispositivo sin nombre';
}

function locationText(device) {
  return [device?.UbicacionCliente, device?.UbicacionEquipo].filter(Boolean).join(' · ') || 'Sin ubicación';
}

function optionFromClient(row) {
  const value = String(pick(row, ['ClienteID', 'id'], '') || '');
  const label = String(pick(row, ['Nombre', 'Clientes', 'RazonSocial'], 'Cliente sin nombre'));
  return value ? { value, label } : null;
}

function relationLocation(row) {
  const id = String(pick(row, ['UbicacionID', 'ubicacionId', 'id', 'RowID'], '') || '');
  return id ? { id, name: String(pick(row, ['Nombre'], 'Ubicación')) } : null;
}

function relationEquipment(row) {
  const id = String(pick(row, ['UbicacionEquipoID', 'ubicacionEquipoId', 'id', 'RowID'], '') || '');
  return id ? {
    id,
    name: String(pick(row, ['Nombre'], 'Ubicación del equipo')),
    locationId: String(pick(row, ['UbicacionID', 'ubicacionId'], '') || ''),
  } : null;
}

export default function IntegrationsPage() {
  const { sessionToken } = useAuth();
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);
  const [gatewayForm, setGatewayForm] = useState({ name: '', clientId: '' });
  const [modalError, setModalError] = useState('');
  const [revealedTokens, setRevealedTokens] = useState({});
  const [editingDevice, setEditingDevice] = useState(null);
  const [deviceRelations, setDeviceRelations] = useState({ locations: [], equipment: [] });
  const [deviceModalError, setDeviceModalError] = useState('');
  const [relationsLoading, setRelationsLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('TODOS');
  const [manufacturerFilter, setManufacturerFilter] = useState('TODAS');
  const [modelFilter, setModelFilter] = useState('TODOS');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

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

  useEffect(() => {
    function hideSecrets() {
      if (document.visibilityState !== 'visible') setRevealedTokens({});
    }
    document.addEventListener('visibilitychange', hideSecrets);
    return () => document.removeEventListener('visibilitychange', hideSecrets);
  }, []);

  useEffect(() => { setPage(1); }, [query, clientFilter, manufacturerFilter, modelFilter, statusFilter, pageSize]);

  const clientOptions = useMemo(() => clients.map(optionFromClient).filter(Boolean), [clients]);
  const gatewayById = useMemo(() => new Map(
    overview.gateways.map((gateway) => [String(gateway.GatewayID || ''), gateway]),
  ), [overview.gateways]);
  const devicesByGateway = useMemo(() => overview.devices.reduce((map, device) => {
    const gatewayId = String(device.GatewayID || '');
    map.set(gatewayId, (map.get(gatewayId) || 0) + 1);
    return map;
  }, new Map()), [overview.devices]);

  const manufacturers = useMemo(() => [...new Set(overview.devices.map((item) => String(item.Fabricante || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es')), [overview.devices]);
  const models = useMemo(() => [...new Set(overview.devices.map((item) => String(item.Modelo || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es')), [overview.devices]);

  const inventoryClientOptions = useMemo(() => {
    const map = new Map();
    overview.gateways.forEach((gateway) => {
      const id = String(gateway.ClienteID || '');
      if (id) map.set(id, String(gateway.Cliente || 'Cliente'));
    });
    clientOptions.forEach((item) => map.set(item.value, item.label));
    return [...map.entries()].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [overview.gateways, clientOptions]);

  const filteredDevices = useMemo(() => {
    const search = normalized(query);
    return overview.devices.filter((device) => {
      const gateway = gatewayById.get(String(device.GatewayID || '')) || {};
      const clientId = String(gateway.ClienteID || device.ClienteID || '');
      if (clientFilter !== 'TODOS' && clientId !== clientFilter) return false;
      if (manufacturerFilter !== 'TODAS' && String(device.Fabricante || '') !== manufacturerFilter) return false;
      if (modelFilter !== 'TODOS' && String(device.Modelo || '') !== modelFilter) return false;
      if (statusFilter !== 'TODOS' && deviceStatus(device) !== statusFilter) return false;
      if (!search) return true;
      return [
        displayName(device),
        device.NombreDetectado,
        device.Fabricante,
        device.Modelo,
        device.DireccionIP,
        device.DireccionMAC,
        gateway.Cliente,
        device.UbicacionCliente,
        device.UbicacionEquipo,
        deviceStatus(device),
      ].some((value) => normalized(value).includes(search));
    }).sort((a, b) => {
      const gatewayA = gatewayById.get(String(a.GatewayID || '')) || {};
      const gatewayB = gatewayById.get(String(b.GatewayID || '')) || {};
      return String(gatewayA.Cliente || '').localeCompare(String(gatewayB.Cliente || ''), 'es')
        || locationText(a).localeCompare(locationText(b), 'es')
        || displayName(a).localeCompare(displayName(b), 'es');
    });
  }, [overview.devices, gatewayById, query, clientFilter, manufacturerFilter, modelFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredDevices.length / pageSize));
  const visibleDevices = filteredDevices.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const onlineDevices = overview.devices.filter((item) => deviceStatus(item) === 'ONLINE').length;
  const highConfidence = overview.devices.filter((item) => item.metadata?.discoveryConfidence === 'HIGH').length;
  const withoutLocation = overview.devices.filter((item) => !item.UbicacionClienteID).length;

  function rememberToken(gatewayId, token, seconds = 30) {
    const id = String(gatewayId || '');
    if (!id || !token) return;
    const expiresAt = Date.now() + Math.max(5, Number(seconds || 30)) * 1_000;
    setRevealedTokens((current) => ({ ...current, [id]: { token, expiresAt } }));
    window.setTimeout(() => {
      setRevealedTokens((current) => {
        if (!current[id] || current[id].expiresAt !== expiresAt) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    }, Math.max(5, Number(seconds || 30)) * 1_000);
  }

  async function copyValue(value, label) {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      setNotice(`${label} copiado al portapapeles.`);
    } catch {
      setError(`No se pudo copiar ${label.toLowerCase()}.`);
    }
  }

  async function provision(event) {
    event.preventDefault();
    if (working) return;
    const name = gatewayForm.name.trim();
    if (!name) {
      setModalError('Escriba un nombre para el gateway.');
      return;
    }
    const selectedClient = clientOptions.find((item) => item.value === gatewayForm.clientId);
    setWorking('provision');
    setModalError('');
    setNotice('');
    try {
      const result = await provisionIntegrationGateway({
        name,
        clientId: selectedClient?.value || '',
        clientName: selectedClient?.label || '',
      }, sessionToken);
      rememberToken(result.gateway.GatewayID, result.token, 30);
      setGatewayForm({ name: '', clientId: '' });
      setGatewayModalOpen(false);
      setNotice(result.credentialRevealAvailable === false
        ? 'Gateway creado. El token está visible temporalmente; configure la llave de cifrado en Render para poder revelarlo después.'
        : 'Gateway creado. El ID y el token quedan disponibles en el desplegable Credenciales.');
      await load({ silent: true });
    } catch (provisionError) {
      setModalError(provisionError.message || 'No se pudo crear el gateway.');
    } finally {
      setWorking('');
    }
  }

  async function revealToken(gatewayId) {
    if (working) return;
    setWorking(`${gatewayId}:reveal`);
    setError('');
    try {
      const result = await revealIntegrationGatewayToken(gatewayId, sessionToken);
      rememberToken(gatewayId, result.token, result.expiresInSeconds || 30);
    } catch (revealError) {
      setError(revealError.message || 'No se pudo revelar el token del gateway.');
    } finally {
      setWorking('');
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

  async function openDeviceEditor(device) {
    if (working) return;
    const gateway = gatewayById.get(String(device.GatewayID || '')) || {};
    setDeviceModalError('');
    setDeviceRelations({ locations: [], equipment: [] });
    setEditingDevice({
      device,
      gateway,
      name: device.NombreOperativo || device.NombreDetectado || '',
      locationId: String(device.UbicacionClienteID || ''),
      equipmentLocationId: String(device.UbicacionEquipoID || ''),
    });
    if (!gateway.ClienteID) return;
    setRelationsLoading(true);
    try {
      const relations = await fetchClientRelations({ clientId: gateway.ClienteID, sessionToken });
      const locations = (relations.locations || []).map(relationLocation).filter(Boolean);
      const equipment = (relations.equipment || []).map(relationEquipment).filter(Boolean);
      setDeviceRelations({ locations, equipment });
    } catch (relationError) {
      setDeviceModalError(relationError.message || 'No se pudieron cargar las ubicaciones del cliente.');
    } finally {
      setRelationsLoading(false);
    }
  }

  async function saveDeviceProfile(event) {
    event.preventDefault();
    if (!editingDevice || working) return;
    const deviceId = editingDevice.device.DispositivoIntegracionID;
    setWorking(`device:${deviceId}`);
    setDeviceModalError('');
    try {
      await updateIntegrationDeviceProfile({
        deviceId,
        name: editingDevice.name.trim(),
        locationId: editingDevice.locationId,
        equipmentLocationId: editingDevice.equipmentLocationId,
      }, sessionToken);
      setEditingDevice(null);
      setNotice('Cámara actualizada. El nombre y la ubicación se conservarán en futuras sincronizaciones.');
      await load({ silent: true });
    } catch (updateError) {
      setDeviceModalError(updateError.message || 'No se pudo actualizar la cámara.');
    } finally {
      setWorking('');
    }
  }

  const equipmentOptions = editingDevice
    ? deviceRelations.equipment.filter((item) => !editingDevice.locationId || item.locationId === editingDevice.locationId)
    : [];

  return <div className="page admin-module-page integration-gateway-page">
    <div className="list-page-heading integration-gateway-heading">
      <div>
        <Link to="/mas" className="back-link"><Icon name="arrow_back" /> Más opciones</Link>
        <span className="eyebrow">INFRAESTRUCTURA LOCAL</span>
        <h1>Gateways e inventario</h1>
        <p>Administre los gateways y las cámaras detectadas con el mismo flujo operativo de los dispositivos de mantenimiento.</p>
      </div>
      <div className="integration-heading-actions">
        <button type="button" className="button button--primary" onClick={() => { setModalError(''); setGatewayModalOpen(true); }} disabled={Boolean(working)}><Icon name="add" /> Crear gateway</button>
        <button type="button" className="button button--secondary" onClick={() => load()} disabled={loading || Boolean(working)}><Icon name={loading ? 'progress_activity' : 'refresh'} /> Actualizar</button>
      </div>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}

    <section className="integration-gateway-section">
      <div className="integration-section-heading"><div><span className="eyebrow">CONEXIONES</span><h2>Gateways</h2><p>Las credenciales permanecen cerradas por defecto y el token solo se revela temporalmente.</p></div></div>
      {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando gateways...</div> : overview.gateways.length ? <div className="integration-gateway-grid integration-gateway-grid--compact">
        {overview.gateways.map((gateway) => {
          const gatewayId = String(gateway.GatewayID || '');
          const active = String(gateway.Estado || '').toUpperCase() === 'ACTIVO';
          const revealed = revealedTokens[gatewayId]?.token || '';
          return <article className="integration-gateway-card integration-gateway-card--compact" key={gatewayId}>
            <header>
              <span className="integration-gateway-card__icon"><Icon name="router" /></span>
              <div><h2>{gateway.Nombre}</h2><p>{gateway.Cliente || 'Sin cliente relacionado'} · {devicesByGateway.get(gatewayId) || 0} dispositivo(s)</p></div>
              <span className={`status-chip ${gateway.online && active ? 'status-chip--active' : active ? 'status-chip--pending' : 'status-chip--danger'}`}>{!active ? 'REVOCADO' : gateway.online ? 'EN LÍNEA' : 'SIN CONEXIÓN'}</span>
            </header>
            <dl className="integration-gateway-quick-data">
              <div><dt>Equipo</dt><dd>{gateway.Hostname || 'No informado'}</dd></div>
              <div><dt>Agente</dt><dd>{gateway.VersionAgente || 'No conectado'} · {gateway.Adaptador || 'SIMULATED'}</dd></div>
              <div><dt>Último contacto</dt><dd>{dateTime(gateway.UltimoContacto)}</dd></div>
            </dl>
            <details className="integration-gateway-credentials">
              <summary><span><Icon name="key" /> Credenciales</span><Icon name="expand_more" /></summary>
              <div className="integration-gateway-credentials__body">
                <label><span>Gateway ID</span><div><code>{gatewayId}</code><button className="icon-button" type="button" onClick={() => copyValue(gatewayId, 'Gateway ID')} aria-label="Copiar Gateway ID"><Icon name="content_copy" /></button></div></label>
                <label><span>Token</span><div><code>{revealed || '••••••••••••••••••••••••'}</code>{revealed ? <button className="icon-button" type="button" onClick={() => copyValue(revealed, 'Token')} aria-label="Copiar token"><Icon name="content_copy" /></button> : <button className="button button--secondary integration-token-reveal" type="button" onClick={() => revealToken(gatewayId)} disabled={Boolean(working)}><Icon name="visibility" /> Mostrar 30 s</button>}</div></label>
              </div>
            </details>
            {active && <div className="integration-gateway-card__actions">
              <button type="button" className="button button--secondary" disabled={Boolean(working)} onClick={() => sendCommand(gatewayId, 'PING')}><Icon name="network_ping" /> Probar conexión</button>
              <button type="button" className="button button--primary" disabled={Boolean(working)} onClick={() => sendCommand(gatewayId, 'INVENTORY_SYNC')}><Icon name="sync" /> Sincronizar</button>
              <button type="button" className="button button--danger" disabled={Boolean(working)} onClick={() => revoke(gateway)}><Icon name="link_off" /> Revocar</button>
            </div>}
          </article>;
        })}
      </div> : <div className="empty-state"><Icon name="router" /><h2>No hay gateways configurados</h2><p>Use Crear gateway para registrar el primer equipo de integración.</p></div>}
    </section>

    <section className="integration-inventory-panel maintenance-device-manager">
      <div className="integration-section-heading"><div><span className="eyebrow">INVENTARIO</span><h2>Dispositivos detectados</h2><p>Filtre, ubique y renombre las cámaras sin cambiar la identidad técnica descubierta por el agente.</p></div></div>

      <section className="maintenance-device-summary maintenance-device-summary--compact integration-device-summary">
        <div><strong>{overview.devices.length}</strong><span>detectados</span></div>
        <div><strong>{onlineDevices}</strong><span>en línea</span></div>
        <div><strong>{highConfidence}</strong><span>confianza alta</span></div>
        <div className={withoutLocation ? 'is-pending' : ''}><strong>{withoutLocation}</strong><span>sin ubicación</span></div>
      </section>

      <div className="maintenance-device-toolbar integration-device-toolbar">
        <label className="maintenance-device-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cámara, IP, MAC, marca, modelo o ubicación..." /></label>
        <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} aria-label="Filtrar por cliente"><option value="TODOS">Todos los clientes</option>{inventoryClientOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select value={manufacturerFilter} onChange={(event) => setManufacturerFilter(event.target.value)} aria-label="Filtrar por marca"><option value="TODAS">Todas las marcas</option>{manufacturers.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} aria-label="Filtrar por modelo"><option value="TODOS">Todos los modelos</option>{models.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado"><option value="TODOS">Todos los estados</option><option value="ONLINE">En línea</option><option value="NO DETECTADO">No detectados</option><option value="UNKNOWN">Sin estado</option></select>
        <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Filas por página">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}</select>
      </div>

      <div className="maintenance-device-category-chips integration-brand-chips" aria-label="Resumen por marca">
        <button type="button" className={manufacturerFilter === 'TODAS' ? 'is-active' : ''} onClick={() => setManufacturerFilter('TODAS')}>Todas <span>{overview.devices.length}</span></button>
        {manufacturers.map((name) => <button type="button" key={name} className={manufacturerFilter === name ? 'is-active' : ''} onClick={() => setManufacturerFilter(name)}>{name} <span>{overview.devices.filter((item) => item.Fabricante === name).length}</span></button>)}
      </div>

      {visibleDevices.length ? <>
        <div className="maintenance-device-table-wrap integration-device-table-wrap">
          <table className="maintenance-device-table integration-device-table">
            <thead><tr><th>#</th><th>Dispositivo</th><th>Cliente</th><th>Ubicación</th><th>Marca / Modelo</th><th>IP / MAC</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
            <tbody>{visibleDevices.map((device, index) => {
              const gateway = gatewayById.get(String(device.GatewayID || '')) || {};
              const status = deviceStatus(device);
              return <tr key={device.DispositivoIntegracionID}>
                <td className="maintenance-device-table__number">{(page - 1) * pageSize + index + 1}</td>
                <td><button type="button" className="maintenance-device-name-button" onClick={() => openDeviceEditor(device)}><span className="maintenance-device-list__icon"><Icon name={device.Tipo === 'CAMERA' ? 'videocam' : 'memory'} /></span><span><strong>{displayName(device)}</strong>{device.NombreOperativo && <small>Detectado: {device.NombreDetectado}</small>}</span></button></td>
                <td>{gateway.Cliente || 'Sin cliente'}</td>
                <td>{locationText(device)}</td>
                <td><strong className="integration-table-primary">{device.Fabricante || 'Marca no identificada'}</strong><small className="integration-table-secondary">{device.Modelo || 'Modelo no identificado'}</small></td>
                <td><strong className="integration-table-primary">{device.DireccionIP || 'Sin IP'}</strong><small className="integration-table-secondary">{device.DireccionMAC || 'Sin MAC'}</small></td>
                <td><span className={`maintenance-device-compact-state ${status === 'ONLINE' ? 'is-good' : 'is-warning'}`}>{status}</span>{device.metadata?.discoveryConfidence && <small className="integration-confidence">Confianza {device.metadata.discoveryConfidence}</small>}</td>
                <td><button type="button" className="icon-button maintenance-device-open" onClick={() => openDeviceEditor(device)} aria-label={`Editar ${displayName(device)}`}><Icon name="edit" /></button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>

        <div className="maintenance-device-mobile-list integration-device-mobile-list">
          {visibleDevices.map((device, index) => {
            const gateway = gatewayById.get(String(device.GatewayID || '')) || {};
            const status = deviceStatus(device);
            return <button type="button" key={device.DispositivoIntegracionID} className="maintenance-device-mobile-row" onClick={() => openDeviceEditor(device)}>
              <span className="maintenance-device-mobile-row__number">{(page - 1) * pageSize + index + 1}</span>
              <span className="maintenance-device-list__icon"><Icon name={device.Tipo === 'CAMERA' ? 'videocam' : 'memory'} /></span>
              <span className="maintenance-device-mobile-row__content"><strong>{displayName(device)}</strong><small>{gateway.Cliente || 'Sin cliente'} · {locationText(device)}</small><small>{[device.Fabricante, device.Modelo, device.DireccionIP].filter(Boolean).join(' · ')}</small><span><em className={status === 'ONLINE' ? 'is-good' : 'is-warning'}>{status}</em></span></span>
              <Icon name="edit" />
            </button>;
          })}
        </div>

        <nav className="maintenance-device-pagination" aria-label="Paginación del inventario"><span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredDevices.length)} de {filteredDevices.length}</span><div><button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><Icon name="chevron_left" /></button><strong>{page} / {totalPages}</strong><button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}><Icon name="chevron_right" /></button></div></nav>
      </> : <div className="empty-state maintenance-device-empty"><Icon name="videocam_off" /><h3>{overview.devices.length ? 'No hay coincidencias' : 'Sin dispositivos detectados'}</h3><p>{overview.devices.length ? 'Cambie los filtros o el texto de búsqueda.' : 'Sincronice un gateway para comenzar a poblar el inventario.'}</p></div>}
    </section>

    {overview.commands.length > 0 && <details className="integration-command-history integration-collapsible-history"><summary><span><Icon name="history" /> Comandos recientes</span><Icon name="expand_more" /></summary><div className="integration-command-list">{overview.commands.slice(0, 20).map((command) => <div key={command.ComandoID}><span className={`status-chip ${statusClass(command.Estado)}`}>{command.Estado}</span><strong>{commandLabel(command.Tipo)}</strong><small>{dateTime(command.FechaCreacion)} · {command.GatewayID}</small>{command.ErrorMensaje && <em>{command.ErrorMensaje}</em>}</div>)}</div></details>}

    <InlineCreateModal open={gatewayModalOpen} title="Crear gateway" description="Registre el equipo local y relácionelo con el cliente que administra esa red." saving={working === 'provision'} error={modalError} onClose={() => { if (working !== 'provision') setGatewayModalOpen(false); }} onSubmit={provision}>
      <label className="field-group"><span className="field-label">Nombre del gateway *</span><input className="form-control" value={gatewayForm.name} onChange={(event) => setGatewayForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Sede principal - servidor de monitoreo" maxLength={160} /></label>
      <label className="field-group"><span className="field-label">Cliente relacionado</span><select className="form-control" value={gatewayForm.clientId} onChange={(event) => setGatewayForm((current) => ({ ...current, clientId: event.target.value }))}><option value="">Sin cliente por ahora</option>{clientOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    </InlineCreateModal>

    <InlineCreateModal open={Boolean(editingDevice)} title="Editar cámara" description={editingDevice ? `${editingDevice.device.DireccionIP || 'Sin IP'} · ${editingDevice.device.NombreDetectado || 'Dispositivo detectado'}` : ''} saving={Boolean(editingDevice && working === `device:${editingDevice.device.DispositivoIntegracionID}`)} error={deviceModalError} onClose={() => { if (!working) setEditingDevice(null); }} onSubmit={saveDeviceProfile}>
      {editingDevice && <>
        <label className="field-group"><span className="field-label">Nombre operativo</span><input className="form-control" value={editingDevice.name} onChange={(event) => setEditingDevice((current) => ({ ...current, name: event.target.value }))} maxLength={250} placeholder={editingDevice.device.NombreDetectado || 'Nombre de la cámara'} /></label>
        <div className="integration-detected-name-note"><Icon name="sensors" /><span>Nombre detectado: <strong>{editingDevice.device.NombreDetectado || 'Sin nombre detectado'}</strong>. Este dato técnico no se modifica.</span></div>
        {editingDevice.gateway.ClienteID ? <>
          <label className="field-group"><span className="field-label">Ubicación del cliente</span><select className="form-control" value={editingDevice.locationId} disabled={relationsLoading} onChange={(event) => setEditingDevice((current) => ({ ...current, locationId: event.target.value, equipmentLocationId: '' }))}><option value="">Sin ubicación asignada</option>{deviceRelations.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field-group"><span className="field-label">Ubicación del equipo</span><select className="form-control" value={editingDevice.equipmentLocationId} disabled={relationsLoading || !editingDevice.locationId} onChange={(event) => setEditingDevice((current) => ({ ...current, equipmentLocationId: event.target.value }))}><option value="">Sin ubicación de equipo</option>{equipmentOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {relationsLoading && <div className="state-card state-card--loading integration-relations-loading"><Icon name="progress_activity" /> Cargando ubicaciones...</div>}
        </> : <div className="alert alert--warning"><Icon name="info" /><span>Este gateway no tiene cliente relacionado. Para asignar una ubicación primero debe estar asociado a un cliente.</span></div>}
      </>}
    </InlineCreateModal>
  </div>;
}
