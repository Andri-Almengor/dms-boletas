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
  updateIntegrationDevicesLocation,
} from '../../services/integrationGatewayApi';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

const EMPTY_OVERVIEW = Object.freeze({
  gateways: [],
  devices: [],
  commands: [],
  summary: { gateways: 0, online: 0, devices: 0, pendingCommands: 0 },
});

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

function folderKey(device) {
  const equipmentId = String(device?.UbicacionEquipoID || '').trim();
  const locationId = String(device?.UbicacionClienteID || '').trim();
  if (equipmentId) return `equipment:${equipmentId}`;
  if (locationId) return `location:${locationId}:unassigned`;
  return 'unassigned';
}

function buildLocationFolders(devices = []) {
  const map = new Map();
  devices.forEach((device) => {
    const key = folderKey(device);
    if (!map.has(key)) {
      map.set(key, {
        key,
        locationId: String(device.UbicacionClienteID || ''),
        locationName: String(device.UbicacionCliente || 'Sin ubicación general'),
        equipmentLocationId: String(device.UbicacionEquipoID || ''),
        equipmentLocationName: String(device.UbicacionEquipo || 'Sin ubicación del equipo'),
        items: [],
      });
    }
    map.get(key).items.push(device);
  });
  return [...map.values()]
    .map((folder) => ({
      ...folder,
      items: [...folder.items].sort((a, b) => displayName(a).localeCompare(displayName(b), 'es', { numeric: true })),
    }))
    .sort((a, b) => (
      a.locationName.localeCompare(b.locationName, 'es', { numeric: true })
      || a.equipmentLocationName.localeCompare(b.equipmentLocationName, 'es', { numeric: true })
    ));
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
  const [selectedDeviceIds, setSelectedDeviceIds] = useState(() => new Set());
  const [bulkEditor, setBulkEditor] = useState(null);
  const [bulkRelations, setBulkRelations] = useState({ locations: [], equipment: [] });
  const [bulkError, setBulkError] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('TODOS');
  const [manufacturerFilter, setManufacturerFilter] = useState('TODAS');
  const [modelFilter, setModelFilter] = useState('TODOS');
  const [statusFilter, setStatusFilter] = useState('TODOS');

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

  useEffect(() => {
    setSelectedDeviceIds(new Set());
    setBulkEditor(null);
    setManufacturerFilter('TODAS');
    setModelFilter('TODOS');
  }, [clientFilter]);

  const clientOptions = useMemo(() => clients.map(optionFromClient).filter(Boolean), [clients]);
  const gatewayById = useMemo(() => new Map(
    overview.gateways.map((gateway) => [String(gateway.GatewayID || ''), gateway]),
  ), [overview.gateways]);

  // Los dispositivos SIMULATED se conservan como datos históricos/técnicos,
  // pero dejan de formar parte del inventario operativo mostrado al usuario.
  const operationalDevices = useMemo(() => overview.devices.filter((device) => (
    String(device.SourceSystem || '').toUpperCase() !== 'SIMULATED'
  )), [overview.devices]);

  const devicesByGateway = useMemo(() => operationalDevices.reduce((map, device) => {
    const gatewayId = String(device.GatewayID || '');
    map.set(gatewayId, (map.get(gatewayId) || 0) + 1);
    return map;
  }, new Map()), [operationalDevices]);

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

  const clientScopedDevices = useMemo(() => operationalDevices.filter((device) => {
    if (clientFilter === 'TODOS') return true;
    const gateway = gatewayById.get(String(device.GatewayID || '')) || {};
    return String(gateway.ClienteID || device.ClienteID || '') === clientFilter;
  }), [operationalDevices, gatewayById, clientFilter]);

  const visibleGateways = useMemo(() => overview.gateways.filter((gateway) => (
    clientFilter === 'TODOS' || String(gateway.ClienteID || '') === clientFilter
  )), [overview.gateways, clientFilter]);

  const manufacturers = useMemo(() => [...new Set(clientScopedDevices
    .map((item) => String(item.Fabricante || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es')), [clientScopedDevices]);
  const models = useMemo(() => [...new Set(clientScopedDevices
    .filter((item) => manufacturerFilter === 'TODAS' || String(item.Fabricante || '') === manufacturerFilter)
    .map((item) => String(item.Modelo || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es')), [clientScopedDevices, manufacturerFilter]);

  useEffect(() => {
    if (manufacturerFilter !== 'TODAS' && !manufacturers.includes(manufacturerFilter)) setManufacturerFilter('TODAS');
  }, [manufacturerFilter, manufacturers]);
  useEffect(() => {
    if (modelFilter !== 'TODOS' && !models.includes(modelFilter)) setModelFilter('TODOS');
  }, [modelFilter, models]);

  const filteredDevices = useMemo(() => {
    const search = normalized(query);
    return clientScopedDevices.filter((device) => {
      const gateway = gatewayById.get(String(device.GatewayID || '')) || {};
      if (manufacturerFilter !== 'TODAS' && String(device.Fabricante || '') !== manufacturerFilter) return false;
      if (modelFilter !== 'TODOS' && String(device.Modelo || '') !== modelFilter) return false;
      if (statusFilter !== 'TODOS' && deviceStatus(device) !== statusFilter) return false;
      if (!search) return true;
      return [
        displayName(device), device.NombreDetectado, device.Fabricante, device.Modelo,
        device.DireccionIP, device.DireccionMAC, gateway.Cliente,
        device.UbicacionCliente, device.UbicacionEquipo, deviceStatus(device),
      ].some((value) => normalized(value).includes(search));
    });
  }, [clientScopedDevices, gatewayById, query, manufacturerFilter, modelFilter, statusFilter]);

  const folders = useMemo(() => buildLocationFolders(filteredDevices), [filteredDevices]);
  const onlineDevices = clientScopedDevices.filter((item) => deviceStatus(item) === 'ONLINE').length;
  const highConfidence = clientScopedDevices.filter((item) => item.metadata?.discoveryConfidence === 'HIGH').length;
  const withoutLocation = clientScopedDevices.filter((item) => !item.UbicacionEquipoID).length;
  const allFilteredSelected = filteredDevices.length > 0
    && filteredDevices.every((device) => selectedDeviceIds.has(device.DispositivoIntegracionID));

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
    if (!name) return setModalError('Escriba un nombre para el gateway.');
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
        : 'Gateway creado. El ID y el token quedan disponibles en Credenciales.');
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

  async function relationsForClient(clientId) {
    const relations = await fetchClientRelations({ clientId, sessionToken });
    return {
      locations: (relations.locations || []).map(relationLocation).filter(Boolean),
      equipment: (relations.equipment || []).map(relationEquipment).filter(Boolean),
    };
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
      setDeviceRelations(await relationsForClient(gateway.ClienteID));
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

  function toggleDeviceSelection(deviceId) {
    if (clientFilter === 'TODOS') return;
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  function toggleAllFiltered() {
    if (clientFilter === 'TODOS' || !filteredDevices.length) return;
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filteredDevices.forEach((device) => next.delete(device.DispositivoIntegracionID));
      else filteredDevices.forEach((device) => next.add(device.DispositivoIntegracionID));
      return next;
    });
  }

  async function openBulkEditor() {
    if (clientFilter === 'TODOS' || !selectedDeviceIds.size || working) return;
    setBulkError('');
    setBulkRelations({ locations: [], equipment: [] });
    setBulkEditor({ locationId: '', equipmentLocationId: '' });
    setBulkLoading(true);
    try {
      setBulkRelations(await relationsForClient(clientFilter));
    } catch (relationError) {
      setBulkError(relationError.message || 'No se pudieron cargar las ubicaciones del cliente.');
    } finally {
      setBulkLoading(false);
    }
  }

  async function saveBulkLocation(event) {
    event.preventDefault();
    if (!bulkEditor || working || !selectedDeviceIds.size) return;
    if (!bulkEditor.locationId || !bulkEditor.equipmentLocationId) {
      setBulkError('Seleccione la ubicación general y la Ubicación del equipo.');
      return;
    }
    setWorking('bulk-location');
    setBulkError('');
    try {
      const result = await updateIntegrationDevicesLocation({
        deviceIds: [...selectedDeviceIds],
        locationId: bulkEditor.locationId,
        equipmentLocationId: bulkEditor.equipmentLocationId,
      }, sessionToken);
      setBulkEditor(null);
      setSelectedDeviceIds(new Set());
      setNotice(`${result.updated} cámara${result.updated === 1 ? '' : 's'} asignada${result.updated === 1 ? '' : 's'} a ${result.UbicacionEquipo}.`);
      await load({ silent: true });
    } catch (updateError) {
      setBulkError(updateError.message || 'No se pudieron mover las cámaras seleccionadas.');
    } finally {
      setWorking('');
    }
  }

  const equipmentOptions = editingDevice
    ? deviceRelations.equipment.filter((item) => !editingDevice.locationId || item.locationId === editingDevice.locationId)
    : [];
  const bulkEquipmentOptions = bulkEditor
    ? bulkRelations.equipment.filter((item) => !bulkEditor.locationId || item.locationId === bulkEditor.locationId)
    : [];

  return <div className="page admin-module-page integration-gateway-page">
    <div className="list-page-heading integration-gateway-heading">
      <div>
        <Link to="/mas" className="back-link"><Icon name="arrow_back" /> Más opciones</Link>
        <span className="eyebrow">INFRAESTRUCTURA LOCAL</span>
        <h1>Gateways e inventario</h1>
        <p>Administre los gateways y organice las cámaras por cliente, ubicación general y Ubicación del equipo.</p>
      </div>
      <div className="integration-heading-actions">
        <button type="button" className="button button--primary" onClick={() => { setModalError(''); setGatewayModalOpen(true); }} disabled={Boolean(working)}><Icon name="add" /> Crear gateway</button>
        <button type="button" className="button button--secondary" onClick={() => load()} disabled={loading || Boolean(working)}><Icon name={loading ? 'progress_activity' : 'refresh'} /> Actualizar</button>
      </div>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}

    <details className="integration-gateway-section integration-gateway-section--collapsible">
      <summary className="integration-gateway-section__summary">
        <span><Icon name="router" /><span><small>CONEXIONES</small><strong>Gateways</strong><em>{visibleGateways.length} configurado{visibleGateways.length === 1 ? '' : 's'}</em></span></span>
        <Icon name="expand_more" />
      </summary>
      <div className="integration-gateway-section__body">
        <p className="integration-gateway-section__hint">Esta sección permanece cerrada por defecto. Las credenciales de cada gateway también permanecen ocultas hasta que las solicite.</p>
        {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando gateways...</div> : visibleGateways.length ? <div className="integration-gateway-grid integration-gateway-grid--compact">
          {visibleGateways.map((gateway) => {
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
                <div><dt>Agente</dt><dd>{gateway.VersionAgente || 'No conectado'} · {gateway.Adaptador || 'Sin adaptador'}</dd></div>
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
        </div> : <div className="empty-state"><Icon name="router" /><h2>No hay gateways para este cliente</h2><p>Cambie el filtro de cliente o cree un gateway nuevo.</p></div>}
      </div>
    </details>

    <section className="integration-inventory-panel maintenance-device-manager">
      <div className="integration-section-heading"><div><span className="eyebrow">INVENTARIO</span><h2>Cámaras por ubicación</h2><p>La Ubicación del cliente identifica la sede general y la Ubicación del equipo funciona como carpeta o zona donde quedan agrupadas las cámaras.</p></div></div>

      <section className="maintenance-device-summary maintenance-device-summary--compact integration-device-summary">
        <div><strong>{clientScopedDevices.length}</strong><span>detectadas</span></div>
        <div><strong>{onlineDevices}</strong><span>en línea</span></div>
        <div><strong>{highConfidence}</strong><span>confianza alta</span></div>
        <div className={withoutLocation ? 'is-pending' : ''}><strong>{withoutLocation}</strong><span>sin zona</span></div>
      </section>

      <div className="maintenance-device-toolbar integration-device-toolbar">
        <label className="maintenance-device-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cámara, IP, MAC, marca, modelo o ubicación..." /></label>
        <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} aria-label="Filtrar por cliente"><option value="TODOS">Todos los clientes</option>{inventoryClientOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select value={manufacturerFilter} onChange={(event) => setManufacturerFilter(event.target.value)} aria-label="Filtrar por marca"><option value="TODAS">Todas las marcas</option>{manufacturers.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} aria-label="Filtrar por modelo"><option value="TODOS">Todos los modelos</option>{models.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado"><option value="TODOS">Todos los estados</option><option value="ONLINE">En línea</option><option value="NO DETECTADO">No detectadas</option><option value="UNKNOWN">Sin estado</option></select>
      </div>

      <div className="maintenance-device-category-chips integration-brand-chips" aria-label="Resumen por marca">
        <button type="button" className={manufacturerFilter === 'TODAS' ? 'is-active' : ''} onClick={() => setManufacturerFilter('TODAS')}>Todas <span>{clientScopedDevices.length}</span></button>
        {manufacturers.map((name) => <button type="button" key={name} className={manufacturerFilter === name ? 'is-active' : ''} onClick={() => setManufacturerFilter(name)}>{name} <span>{clientScopedDevices.filter((item) => item.Fabricante === name).length}</span></button>)}
      </div>

      {clientFilter === 'TODOS' ? <div className="integration-bulk-hint"><Icon name="info" /><span>Seleccione un cliente para habilitar la selección masiva y asignar cámaras rápidamente a una Ubicación del equipo.</span></div> : <div className="integration-bulk-toolbar">
        <label><input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} disabled={!filteredDevices.length || Boolean(working)} /><Icon name={allFilteredSelected ? 'check_box' : selectedDeviceIds.size ? 'indeterminate_check_box' : 'check_box_outline_blank'} /><span>{allFilteredSelected ? 'Deseleccionar filtradas' : 'Seleccionar todas las filtradas'}</span></label>
        <strong>{selectedDeviceIds.size} seleccionada{selectedDeviceIds.size === 1 ? '' : 's'}</strong>
        <button className="button button--primary button--compact" type="button" onClick={openBulkEditor} disabled={!selectedDeviceIds.size || Boolean(working)}><Icon name="drive_file_move" /> Asignar ubicación</button>
      </div>}

      {folders.length ? <div className="integration-location-folders">
        {folders.map((folder) => <details className="integration-location-folder" key={folder.key}>
          <summary>
            <span className="integration-location-folder__icon"><Icon name={folder.equipmentLocationId ? 'folder' : 'folder_off'} /></span>
            <span className="integration-location-folder__text"><strong>{folder.equipmentLocationName}</strong><small>{folder.locationName} · {folder.items.length} cámara{folder.items.length === 1 ? '' : 's'}</small></span>
            <Icon name="expand_more" />
          </summary>
          <div className="integration-location-folder__body">
            <div className="maintenance-device-table-wrap integration-device-table-wrap">
              <table className="maintenance-device-table integration-device-table">
                <thead><tr>{clientFilter !== 'TODOS' && <th className="integration-selection-column">Sel.</th>}<th>Dispositivo</th><th>Marca / Modelo</th><th>IP / MAC</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
                <tbody>{folder.items.map((device) => {
                  const status = deviceStatus(device);
                  const selected = selectedDeviceIds.has(device.DispositivoIntegracionID);
                  return <tr key={device.DispositivoIntegracionID} className={selected ? 'is-selected-for-move' : ''}>
                    {clientFilter !== 'TODOS' && <td className="integration-selection-cell"><label><input type="checkbox" checked={selected} onChange={() => toggleDeviceSelection(device.DispositivoIntegracionID)} disabled={Boolean(working)} /><Icon name={selected ? 'check_box' : 'check_box_outline_blank'} /></label></td>}
                    <td><button type="button" className="maintenance-device-name-button" onClick={() => openDeviceEditor(device)}><span className="maintenance-device-list__icon"><Icon name="videocam" /></span><span><strong>{displayName(device)}</strong>{device.NombreOperativo && <small>Detectado: {device.NombreDetectado}</small>}</span></button></td>
                    <td><strong className="integration-table-primary">{device.Fabricante || 'Marca no identificada'}</strong><small className="integration-table-secondary">{device.Modelo || 'Modelo no identificado'}</small></td>
                    <td><strong className="integration-table-primary">{device.DireccionIP || 'Sin IP'}</strong><small className="integration-table-secondary">{device.DireccionMAC || 'Sin MAC'}</small></td>
                    <td><span className={`maintenance-device-compact-state ${status === 'ONLINE' ? 'is-good' : 'is-warning'}`}>{status}</span>{device.metadata?.discoveryConfidence && <small className="integration-confidence">Confianza {device.metadata.discoveryConfidence}</small>}</td>
                    <td><button type="button" className="icon-button maintenance-device-open" onClick={() => openDeviceEditor(device)} aria-label={`Editar ${displayName(device)}`}><Icon name="edit" /></button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="maintenance-device-mobile-list integration-device-mobile-list">
              {folder.items.map((device) => {
                const status = deviceStatus(device);
                const selected = selectedDeviceIds.has(device.DispositivoIntegracionID);
                return <div key={device.DispositivoIntegracionID} className={`integration-device-mobile-card${selected ? ' is-selected-for-move' : ''}`}>
                  {clientFilter !== 'TODOS' && <label className="integration-device-mobile-card__select"><input type="checkbox" checked={selected} onChange={() => toggleDeviceSelection(device.DispositivoIntegracionID)} disabled={Boolean(working)} /><Icon name={selected ? 'check_box' : 'check_box_outline_blank'} /></label>}
                  <button type="button" className="maintenance-device-mobile-row" onClick={() => openDeviceEditor(device)}><span className="maintenance-device-list__icon"><Icon name="videocam" /></span><span className="maintenance-device-mobile-row__content"><strong>{displayName(device)}</strong><small>{[device.Fabricante, device.Modelo, device.DireccionIP].filter(Boolean).join(' · ')}</small><span><em className={status === 'ONLINE' ? 'is-good' : 'is-warning'}>{status}</em></span></span><Icon name="edit" /></button>
                </div>;
              })}
            </div>
          </div>
        </details>)}
      </div> : <div className="empty-state maintenance-device-empty"><Icon name="videocam_off" /><h3>{clientScopedDevices.length ? 'No hay coincidencias' : 'Sin cámaras detectadas'}</h3><p>{clientScopedDevices.length ? 'Cambie los filtros o el texto de búsqueda.' : 'Sincronice un gateway de red para comenzar a poblar el inventario.'}</p></div>}
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

    <InlineCreateModal open={Boolean(bulkEditor)} title={`Asignar ubicación a ${selectedDeviceIds.size} cámara${selectedDeviceIds.size === 1 ? '' : 's'}`} description="Todas las cámaras seleccionadas quedarán agrupadas en la misma Ubicación del equipo, igual que los dispositivos de mantenimiento." saving={working === 'bulk-location'} error={bulkError} onClose={() => { if (!working) setBulkEditor(null); }} onSubmit={saveBulkLocation}>
      {bulkEditor && <>
        <label className="field-group"><span className="field-label">Ubicación del cliente</span><select className="form-control" value={bulkEditor.locationId} disabled={bulkLoading} onChange={(event) => setBulkEditor((current) => ({ ...current, locationId: event.target.value, equipmentLocationId: '' }))}><option value="">Seleccione ubicación general</option>{bulkRelations.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-group"><span className="field-label">Ubicación del equipo</span><select className="form-control" value={bulkEditor.equipmentLocationId} disabled={bulkLoading || !bulkEditor.locationId} onChange={(event) => setBulkEditor((current) => ({ ...current, equipmentLocationId: event.target.value }))}><option value="">Seleccione carpeta / zona</option>{bulkEquipmentOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {bulkLoading && <div className="state-card state-card--loading integration-relations-loading"><Icon name="progress_activity" /> Cargando ubicaciones...</div>}
      </>}
    </InlineCreateModal>
  </div>;
}
