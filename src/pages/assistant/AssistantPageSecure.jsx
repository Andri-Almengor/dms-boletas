import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import '../../styles/assistant-sensitive.css';

// Solo describir etapas verificables en el navegador, nunca herramientas supuestas del backend.
const ASSISTANT_PROGRESS_STATES = [
  'Preparando consulta…',
  'Esperando respuesta del servidor…',
  'La consulta sigue en curso…',
  'La respuesta está tardando más de lo habitual. Puede continuar cuando llegue.',
];

const ASSISTANT_FILE_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt']);
const MAX_ASSISTANT_FILES = 50;
const MAX_ASSISTANT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_VOICE_RECORDING_BYTES = 3 * 1024 * 1024;
const MAX_VOICE_RECORDING_MS = 90_000;

const STARTER_QUESTIONS = [
  '¿Cuántas boletas hay pendientes?',
  '¿Cuántas boletas hizo Francisco este mes?',
  'Dame el mantenimiento de Banco Central',
  '¿Qué dice la base de conocimiento sobre OnGuard?',
  '¿Qué sabes de Milestone XProtect?',
];

function storageKey(userId, suffix) {
  return `dms_assistant_${suffix}_${userId || 'user'}`;
}

function initialMessage() {
  return {
    id: 'welcome',
    role: 'assistant',
    text: 'Puede preguntarme libremente por boletas, mantenimientos, dispositivos, clientes, técnicos, casos y la base de conocimiento. También puedo ayudar con preguntas generales y, cuando esté habilitado, buscar información externa. Los datos internos siempre se consultan bajo sus permisos.',
    sources: [],
    options: [],
    suggestions: STARTER_QUESTIONS,
    confirmations: [],
    tables: [],
    stats: [],
    sensitive: false,
  };
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* QuotaExceededError o almacenamiento restringido */ }
}

function safeStorageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* El historial en memoria continúa disponible */ }
}

function assistantFailureMessage(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || 0);
  if (status === 401) return 'La sesión expiró. Inicie sesión nuevamente y conserve su consulta.';
  if (status === 403) return 'Su usuario no tiene permiso para esta operación.';
  if (code === 'UNKNOWN_RESULT') return 'No se pudo confirmar el resultado. Antes de repetir una confirmación, consulte el estado de la operación.';
  if (code === 'SERVER_BUSY' || code === 'SERVER_BUSY_TIMEOUT') return 'El asistente tiene demasiadas solicitudes. Intente de nuevo en unos momentos; las demás funciones de DMS siguen disponibles.';
  if (code === 'ONLINE_REQUIRED' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'No hay conexión con el servidor. Conserve la consulta para enviarla cuando vuelva la conexión.';
  if (/^(MODEL_|GEMINI_|AI_GEMINI_|AI_AGENT_TOTAL_TIMEOUT)/.test(code)) return 'Gemini no pudo completar la respuesta. DMS puede seguir disponible. Intente nuevamente cuando se recupere el servicio.';
  if (code === 'REQUEST_TIMEOUT') return 'La solicitud superó el tiempo de espera. Compruebe el estado de cualquier operación pendiente antes de repetirla.';
  return error?.message || 'No se pudo consultar el asistente.';
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(safeStorageGet(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function pageContextFromRoute(route) {
  const cleanRoute = String(route || '').split('?')[0];
  const maintenance = cleanRoute.match(/^\/mantenimientos\/([^/]+)$/);
  if (maintenance) return { route: cleanRoute, entityType: 'maintenance', entityId: decodeURIComponent(maintenance[1]), maintenanceId: decodeURIComponent(maintenance[1]) };
  const ticket = cleanRoute.match(/^\/boletas\/([^/]+)$/);
  if (ticket && !['pendientes', 'finalizadas', 'nueva'].includes(ticket[1])) return { route: cleanRoute, entityType: 'ticket', entityId: decodeURIComponent(ticket[1]) };
  const knowledge = cleanRoute.match(/^\/conocimiento\/([^/]+)$/);
  if (knowledge && knowledge[1] !== 'nuevo' && knowledge[1] !== 'categorias') return { route: cleanRoute, entityType: 'knowledge', entityId: decodeURIComponent(knowledge[1]) };
  const customerCase = cleanRoute.match(/^\/casos\/([^/]+)$/);
  if (customerCase) return { route: cleanRoute, entityType: 'case', entityId: decodeURIComponent(customerCase[1]), caseId: decodeURIComponent(customerCase[1]) };
  return { route: cleanRoute };
}

function messageId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function assistantFileAllowed(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = String(file?.name || '');
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return ASSISTANT_FILE_EXTENSIONS.has(extension);
}

function assistantFileMime(file) {
  const supplied = String(file?.type || '').trim().toLowerCase();
  if (supplied && supplied !== 'application/octet-stream') return supplied;
  const extension = String(file?.name || '').toLowerCase().split('.').pop();
  const map = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[extension] || supplied || 'application/octet-stream';
}

function humanFileSize(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const block = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + block)));
  }
  return btoa(binary);
}

async function uploadAssistantAttachment(item, sessionToken) {
  const initialized = await apiRequest('assistant.chat', {
    assistantAction: 'attachment.init',
    uploadId: item.id,
    fileName: item.file.name,
    mimeType: assistantFileMime(item.file),
    size: item.file.size,
  }, sessionToken, { cache: 'no-store' });

  const existing = initialized?.uploadId || initialized?.evidence?.uploadId;
  if (initialized?.complete && existing) {
    return {
      uploadId: existing,
      name: initialized.name || initialized.evidence?.name || item.file.name,
      mimeType: initialized.mimeType || initialized.evidence?.mimeType || assistantFileMime(item.file),
      size: Number(initialized.size || initialized.evidence?.size || item.file.size),
    };
  }

  const uploadToken = initialized?.uploadToken;
  const chunkBytes = Math.max(256 * 1024, Number(initialized?.chunkBytes || 4 * 1024 * 1024));
  if (!uploadToken) throw new Error('No se pudo iniciar la carga segura del adjunto.');

  let offset = 0;
  while (offset < item.file.size) {
    const end = Math.min(item.file.size, offset + chunkBytes);
    const base64 = await blobBase64(item.file.slice(offset, end));
    const result = await apiRequest('assistant.chat', {
      assistantAction: 'attachment.chunk',
      uploadToken,
      offset,
      base64,
    }, sessionToken, { cache: 'no-store' });
    const completedId = result?.uploadId || result?.evidence?.uploadId;
    if (result?.complete && completedId) {
      return {
        uploadId: completedId,
        name: result.name || result.evidence?.name || item.file.name,
        mimeType: result.mimeType || result.evidence?.mimeType || assistantFileMime(item.file),
        size: Number(result.size || result.evidence?.size || item.file.size),
      };
    }
    const nextOffset = Number(result?.nextOffset);
    offset = Number.isFinite(nextOffset) && nextOffset > offset ? nextOffset : end;
  }

  throw new Error(`No se pudo completar la carga de ${item.file.name}.`);
}

function text(value, fallback = '—') {
  const clean = String(value ?? '').trim();
  return clean || fallback;
}

function combine(values, separator = ' · ') {
  const valid = values.map((value) => String(value ?? '').trim()).filter(Boolean);
  return valid.length ? valid.join(separator) : '—';
}

function buildPresentation(facts = {}) {
  const tables = [];
  const stats = [];
  const catalog = facts.catalogResults;

  if (facts.credentialResults && Array.isArray(facts.credentialResults.rows)) {
    const credentials = facts.credentialResults;
    tables.push({
      id: 'credential-results',
      title: `Credenciales de ${text(credentials.clientName, 'cliente')}`,
      description: credentials.categoryName ? `Categoría: ${credentials.categoryName}` : 'Resultados autorizados del gestor de contraseñas',
      sensitive: true,
      columns: [
        { key: 'category', label: 'Categoría' },
        { key: 'system', label: 'Sistema o servicio', primary: true, wide: true },
        { key: 'username', label: 'Usuario' },
        { key: 'password', label: 'Contraseña', secret: true },
        { key: 'url', label: 'Acceso', wide: true },
      ],
      rows: credentials.rows.map((item, index) => ({
        id: item.id || `credential-${index}`,
        category: text(item.categoryName),
        system: text(item.name),
        username: text(item.username),
        password: String(item.password || ''),
        url: text(item.url),
      })),
    });
    stats.push(
      { label: 'Credenciales', value: Number(credentials.total ?? credentials.rows.length), icon: 'key' },
      { label: 'Cliente', value: text(credentials.clientName), icon: 'corporate_fare' },
      ...(credentials.categoryName ? [{ label: 'Categoría', value: credentials.categoryName, icon: 'folder' }] : []),
    );
  }

  if (facts.caseSummary) {
    const summary = facts.caseSummary;
    stats.push(
      { label: 'Casos activos', value: Number(summary.active || 0), icon: 'support_agent' },
      { label: 'En espera', value: Number(summary.waiting || 0), icon: 'schedule' },
      { label: 'En proceso', value: Number(summary.processing || 0), icon: 'engineering' },
      { label: 'Sin asignar', value: Number(summary.unassigned || 0), icon: 'person_off' },
      { label: 'Nuevos hoy', value: Number(summary.newToday || 0), icon: 'new_releases' },
    );
  }

  if (Array.isArray(facts.recentCases) && facts.recentCases.length) {
    tables.push({
      id: 'recent-cases',
      title: 'Casos recientes',
      description: facts.caseSummary?.scope || '',
      columns: [
        { key: 'number', label: 'Caso', primary: true },
        { key: 'client', label: 'Cliente' },
        { key: 'reason', label: 'Razón de visita', wide: true },
        { key: 'status', label: 'Estado', status: true },
        { key: 'assigned', label: 'Asignación', status: true },
        { key: 'createdAt', label: 'Creado' },
      ],
      rows: facts.recentCases.map((item, index) => ({
        id: item.id || `case-${index}`,
        number: text(item.number),
        client: text(item.client),
        reason: text(item.reason),
        status: text(item.status).replace(/_/g, ' '),
        assigned: item.assigned ? 'Asignado' : 'Sin asignar',
        createdAt: text(item.createdAt),
      })),
    });
  }

  if (catalog && Array.isArray(catalog.rows) && catalog.rows.length) {
    const isManufacturers = catalog.kind === 'manufacturers';
    const columns = isManufacturers
      ? [
        { key: 'name', label: 'Fabricante', primary: true },
        { key: 'category', label: 'Tipo de dispositivo' },
        { key: 'count', label: catalog.scope === 'maintenance' ? 'Dispositivos' : 'Modelos', numeric: true },
        { key: 'description', label: 'Descripción', wide: true },
        { key: 'status', label: 'Estado', status: true },
      ]
      : [
        { key: 'name', label: 'Modelo', primary: true },
        { key: 'manufacturer', label: 'Fabricante' },
        { key: 'category', label: 'Tipo de dispositivo' },
        ...(catalog.scope === 'maintenance' ? [{ key: 'count', label: 'Dispositivos', numeric: true }] : []),
        { key: 'description', label: 'Descripción', wide: true },
        { key: 'status', label: 'Estado', status: true },
      ];

    tables.push({
      id: 'catalog-results',
      title: text(catalog.title, isManufacturers ? 'Fabricantes' : 'Modelos'),
      description: text(catalog.description, ''),
      columns,
      rows: catalog.rows.map((item, index) => ({
        id: item.id || `catalog-${index}`,
        name: text(item.name),
        manufacturer: text(item.manufacturer),
        category: text(item.category),
        count: Number(item.count || 0),
        description: text(item.description),
        status: text(item.status, catalog.scope === 'maintenance' ? 'Registrado' : 'ACTIVO'),
      })),
    });

    stats.push(
      { label: isManufacturers ? 'Fabricantes' : 'Modelos', value: Number(catalog.totalResults ?? catalog.rows.length), icon: isManufacturers ? 'factory' : 'view_in_ar' },
      ...(catalog.scope === 'maintenance'
        ? [{ label: 'Dispositivos relacionados', value: Number(catalog.totalDevices || 0), icon: 'devices' }]
        : []),
      ...(catalog.category ? [{ label: 'Tipo', value: catalog.category, icon: 'category' }] : []),
    );
  }

  if (Array.isArray(facts.devices) && facts.devices.length) {
    tables.push({
      id: 'attention-devices',
      title: `${text(facts.category, 'Dispositivos')} que requieren atención`,
      description: facts.maintenance?.title
        ? `${facts.maintenance.title}${facts.maintenance.date ? ` · ${facts.maintenance.date}` : ''}`
        : '',
      columns: [
        { key: 'device', label: 'Dispositivo', primary: true },
        { key: 'zone', label: 'Zona' },
        { key: 'equipment', label: 'Equipo' },
        { key: 'serial', label: 'Serie' },
        { key: 'functioning', label: 'Funcionamiento', status: true },
        { key: 'inUse', label: 'En uso' },
        { key: 'state', label: 'Estado', status: true },
        { key: 'observation', label: 'Observación', wide: true },
        { key: 'evidence', label: 'Evidencias', numeric: true },
      ],
      rows: facts.devices.map((device, index) => ({
        id: device.id || `${device.name}-${index}`,
        device: combine([device.name, device.category], ' — '),
        zone: text(device.zone),
        equipment: combine([device.manufacturer, device.model]),
        serial: text(device.serial),
        functioning: text(device.functioning),
        inUse: text(device.inUse),
        state: text(device.state, 'Requiere atención'),
        observation: text(device.observation),
        evidence: Number(device.evidenceCount || 0),
      })),
    });
  }

  if (Array.isArray(facts.byQuestion) && facts.byQuestion.length) {
    tables.push({
      id: 'survey-questions',
      title: 'Promedio por pregunta',
      description: facts.period || '',
      columns: [
        { key: 'question', label: 'Pregunta', primary: true, wide: true },
        { key: 'average', label: 'Promedio', numeric: true, status: true },
        { key: 'responses', label: 'Respuestas', numeric: true },
      ],
      rows: facts.byQuestion.map((item, index) => ({
        id: `survey-${index}`,
        question: text(item.question),
        average: `${Number(item.average || 0).toFixed(2)} / 5`,
        responses: Number(item.responses || 0),
      })),
    });
  }

  if (Array.isArray(facts.recentTickets) && facts.recentTickets.length) {
    tables.push({
      id: 'recent-tickets',
      title: 'Boletas recientes',
      columns: [
        { key: 'number', label: 'Boleta', primary: true },
        { key: 'date', label: 'Fecha' },
        { key: 'title', label: 'Trabajo', wide: true },
        { key: 'status', label: 'Estado', status: true },
        { key: 'result', label: 'Resultado', wide: true },
      ],
      rows: facts.recentTickets.map((ticket) => ({
        id: ticket.uid,
        number: `#${text(ticket.number)}`,
        date: text(ticket.date),
        title: text(ticket.title),
        status: text(ticket.status),
        result: text(ticket.result || ticket.description),
      })),
    });
  }

  if (Array.isArray(facts.recentMaintenances) && facts.recentMaintenances.length) {
    tables.push({
      id: 'recent-maintenances',
      title: 'Mantenimientos recientes',
      columns: [
        { key: 'date', label: 'Fecha' },
        { key: 'title', label: 'Mantenimiento', primary: true, wide: true },
        { key: 'status', label: 'Estado', status: true },
        { key: 'devices', label: 'Dispositivos', numeric: true },
        { key: 'description', label: 'Descripción', wide: true },
      ],
      rows: facts.recentMaintenances.map((maintenance) => ({
        id: maintenance.id,
        date: text(maintenance.date),
        title: text(maintenance.title),
        status: text(maintenance.status),
        devices: Number(maintenance.registeredDevices || 0),
        description: text(maintenance.description),
      })),
    });
  }

  if (facts.category && Number.isFinite(Number(facts.registered)) && Number.isFinite(Number(facts.expected))) {
    stats.push(
      { label: 'Categoría', value: facts.category, icon: 'category' },
      { label: 'Registrados', value: Number(facts.registered || 0), icon: 'inventory_2' },
      { label: 'Esperados', value: Number(facts.expected || 0), icon: 'target' },
      { label: 'Faltantes', value: Number(facts.missing || 0), icon: 'pending_actions' },
    );
  }

  if (Number.isFinite(Number(facts.responded)) && Object.prototype.hasOwnProperty.call(facts, 'average')) {
    stats.push(
      { label: 'Encuestas respondidas', value: Number(facts.responded || 0), icon: 'reviews' },
      { label: 'Promedio general', value: `${Number(facts.average || 0).toFixed(2)} / 5`, icon: 'star' },
    );
  }

  return { tables, stats };
}

function statusClass(value) {
  const normalizedValue = String(value || '').toLowerCase();
  if (/mal|falla|atenci|no funciona|pendiente|sin asignar|en espera/.test(normalizedValue)) return 'is-danger';
  if (/correct|bien|si|sí|finaliz|respondida|activo|registrado|asignado|en proceso/.test(normalizedValue)) return 'is-success';
  return 'is-neutral';
}

function AssistantSecretCell({ value }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => setVisible(false), 30_000);
    const hideWhenBackgrounded = () => {
      if (document.visibilityState === 'hidden') setVisible(false);
    };
    document.addEventListener('visibilitychange', hideWhenBackgrounded);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', hideWhenBackgrounded);
    };
  }, [visible]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setVisible(true);
    }
  }

  return <span className="assistant-secret-cell">
    <code>{visible ? String(value || '') : '••••••••••••'}</code>
    <button type="button" onClick={() => setVisible((current) => !current)} title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}><Icon name={visible ? 'visibility_off' : 'visibility'} /></button>
    <button type="button" onClick={copy} title="Copiar contraseña"><Icon name={copied ? 'check' : 'content_copy'} /></button>
  </span>;
}

function AssistantDataTable({ table }) {
  return (
    <section className={`assistant-data-card${table.sensitive ? ' is-sensitive' : ''}`}>
      <header>
        <div>
          <span className="assistant-data-card__eyebrow"><Icon name={table.sensitive ? 'shield_lock' : 'table_view'} /> {table.sensitive ? 'Información sensible' : 'Resultado detallado'}</span>
          <h3>{table.title}</h3>
          {table.description && <p>{table.description}</p>}
        </div>
        <span className="assistant-data-card__count">{table.rows.length}</span>
      </header>
      <div className="assistant-data-table-wrap">
        <table className="assistant-data-table">
          <thead>
            <tr>{table.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id}>
                {table.columns.map((column) => (
                  <td key={column.key} data-label={column.label} className={`${column.primary ? 'is-primary' : ''}${column.wide ? ' is-wide' : ''}${column.numeric ? ' is-numeric' : ''}`}>
                    {column.secret
                      ? <AssistantSecretCell value={row[column.key]} />
                      : column.status
                        ? <span className={`assistant-data-status ${statusClass(row[column.key])}`}>{text(row[column.key])}</span>
                        : text(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssistantStats({ stats }) {
  if (!stats?.length) return null;
  return (
    <div className="assistant-stat-grid">
      {stats.map((stat) => (
        <div key={`${stat.label}-${stat.value}`} className="assistant-stat-card">
          <Icon name={stat.icon} />
          <strong>{stat.value}</strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

function sourceIcon(type) {
  if (type === 'knowledge') return 'menu_book';
  if (type === 'knowledge_document' || type === 'knowledge_document_chunk') return 'description';
  if (type === 'ticket') return 'description';
  if (type === 'maintenance') return 'engineering';
  if (type === 'client') return 'business';
  if (type === 'device' || type === 'network_device') return 'videocam';
  if (type === 'agenda') return 'calendar_month';
  if (type === 'case' || type === 'cases') return 'support_agent';
  if (type === 'external') return 'public';
  if (type === 'surveys') return 'reviews';
  if (type === 'catalog') return 'inventory_2';
  return 'engineering';
}

function inlineMarkdown(value, keyPrefix = 'inline') {
  const parts = String(value || '').split(/(\*\*[^*]+\*\*|\`[^\`]+\`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</code>;
    return <React.Fragment key={`${keyPrefix}-${index}`}>{part}</React.Fragment>;
  });
}

function AssistantMarkdown({ value, messageId: currentMessageId }) {
  const lines = String(value || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    if (line.startsWith('|')) {
      const tableLines = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      const parsed = tableLines.map((row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
      const hasHeader = parsed.length >= 2 && parsed[1].every((cell) => /^:?-{3,}:?$/.test(cell));
      const header = hasHeader ? parsed[0] : null;
      const rows = hasHeader ? parsed.slice(2) : parsed;
      blocks.push(
        <div className="assistant-markdown-table-wrap" key={`${currentMessageId}-table-${index}`}>
          <table className="assistant-markdown-table">
            {header && <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell, `h-${index}-${cellIndex}`)}</th>)}</tr></thead>}
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineMarkdown(cell, `c-${index}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Tag = heading[1].length === 1 ? 'h3' : 'h4';
      blocks.push(<Tag key={`${currentMessageId}-heading-${index}`}>{inlineMarkdown(heading[2], `heading-${index}`)}</Tag>);
      index += 1;
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      blocks.push(<div className="assistant-markdown-list-item" key={`${currentMessageId}-bullet-${index}`}>• <span>{inlineMarkdown(bullet[1], `bullet-${index}`)}</span></div>);
      index += 1;
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      blocks.push(<div className="assistant-markdown-list-item" key={`${currentMessageId}-ordered-${index}`}><span className="assistant-markdown-list-number">{line.match(/^\d+/)?.[0]}.</span><span>{inlineMarkdown(ordered[1], `ordered-${index}`)}</span></div>);
      index += 1;
      continue;
    }
    blocks.push(<p key={`${currentMessageId}-p-${index}`}>{inlineMarkdown(line, `p-${index}`)}</p>);
    index += 1;
  }
  return blocks;
}

function AssistantEntities({ entities = [] }) {
  if (!entities.length) return null;
  return (
    <div className="assistant-entity-grid">
      {entities.slice(0, 12).map((item) => (
        <Link className="assistant-entity-card" key={`${item.type}-${item.id}`} to={item.route || '#'}>
          <Icon name={sourceIcon(item.type)} />
          <span><small>{item.type}</small><strong>{item.label}</strong></span>
          <Icon name="chevron_right" />
        </Link>
      ))}
    </div>
  );
}

function AssistantAttachments({ attachments = [] }) {
  if (!attachments.length) return null;
  return (
    <div className="assistant-attachment-grid">
      {attachments.slice(0, 50).map((item, index) => (
        <article className={`assistant-attachment-card assistant-attachment-card--${item.type || 'file'}`} key={`${item.entityId || 'file'}-${index}-${item.title}`}>
          <header><strong>{item.title || 'Archivo'}</strong>{item.subtitle && <span>{item.subtitle}</span>}</header>
          {item.type === 'image' && <a href={item.url} target="_blank" rel="noreferrer"><img loading="lazy" src={item.url} alt={item.title || 'Evidencia'} /></a>}
          {item.type === 'video' && <video controls preload="metadata" src={item.url} />}
          {(item.type === 'pdf' || item.type === 'file') && <a className="assistant-attachment-link" href={item.url} target="_blank" rel="noreferrer"><Icon name={item.type === 'pdf' ? 'picture_as_pdf' : 'attach_file'} /> Abrir {item.type === 'pdf' ? 'PDF' : 'archivo'}</a>}
        </article>
      ))}
    </div>
  );
}

function AssistantUserFiles({ files = [] }) {
  if (!files.length) return null;
  return (
    <div className="assistant-user-files">
      {files.map((file) => (
        <span key={file.uploadId || file.name} className="assistant-user-file">
          <Icon name={String(file.mimeType || '').startsWith('image/') ? 'image' : 'attach_file'} />
          <span><strong>{file.name}</strong><small>{humanFileSize(file.size)}</small></span>
        </span>
      ))}
    </div>
  );
}

const TICKET_PROPOSAL_FIELDS = [
  ['title', 'Título'], ['client', 'Cliente'], ['date', 'Fecha (AAAA-MM-DD)'],
  ['startTime', 'Inicio (HH:mm)'], ['endTime', 'Final (HH:mm)'],
  ['category', 'Categoría'], ['failureType', 'Tipo de falla'],
  ['deviceType', 'Tipo de equipo'], ['deviceName', 'Nombre del equipo'],
  ['location', 'Sede / ubicación'], ['equipmentLocation', 'Ubicación del equipo'],
  ['supervisor', 'Supervisor'], ['manufacturer', 'Fabricante'],
  ['model', 'Modelo'], ['serial', 'Serie'], ['mac', 'Dirección MAC'],
  ['technicians', 'Técnicos (separados por coma)'],
  ['reason', 'Razón de visita'], ['tests', 'Pruebas realizadas'],
  ['result', 'Resultado'], ['recommendations', 'Recomendaciones'],
  ['followUpOf', 'Seguimiento de boleta del lote (0 = independiente)'],
];
function AssistantConfirmations({ confirmations = [], busyOperationId, onDecision, onRevise, onStatus }) {
  const [ticketDrafts, setTicketDrafts] = useState({});
  function fieldValue(item, row, field) {
    const edited = ticketDrafts[item.operationId]?.[row.index]?.[field];
    if (edited !== undefined) return edited;
    const stored = field === 'deviceName' ? row.device : field === 'followUpOf' ? (row.followUpOf ?? 0) : row[field];
    return Array.isArray(stored) ? stored.join(', ') : String(stored ?? '');
  }
  function setField(item, row, field, value) {
    setTicketDrafts((current) => ({
      ...current,
      [item.operationId]: {
        ...(current[item.operationId] || {}),
        [row.index]: { ...(current[item.operationId]?.[row.index] || {}), [field]: value },
      },
    }));
  }
  async function submitRevision(event, item, row) {
    event.preventDefault();
    const input = ticketDrafts[item.operationId]?.[row.index] || {};
    if (!Object.keys(input).length) return;
    const fields = { ...input };
    if (fields.technicians !== undefined) fields.technicians = fields.technicians.split(',').map(value => value.trim()).filter(Boolean);
    if (fields.followUpOf !== undefined) fields.followUpOf = Number(fields.followUpOf) || 0;
    const succeeded = await onRevise(item, row.index, fields);
    if (succeeded) {
      setTicketDrafts((current) => {
        const next = { ...current };
        const perOperation = { ...(next[item.operationId] || {}) };
        delete perOperation[row.index];
        next[item.operationId] = perOperation;
        return next;
      });
    }
  }
  if (!confirmations.length) return null;
  return (
    <div className="assistant-confirmation-list">
      {confirmations.map((item) => {
        const status = String(item.status || 'PENDING').toUpperCase();
        const busy = busyOperationId === item.operationId;
        const result = item.result || {};
        const ticketProposals = item.action === 'TICKET_BATCH_CREATE' && Array.isArray(item.preview?.tickets) ? item.preview.tickets : [];
        const partial = status === 'PARTIAL';
        const terminal = ['COMMITTED', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(status);
        return (
          <section className="assistant-confirmation-card" key={item.operationId}>
            <header>
              <span><Icon name={status === 'COMMITTED' ? 'check_circle' : partial ? 'warning' : 'fact_check'} /> Operación controlada</span>
              <strong>{item.title || 'Confirmación requerida'}</strong>
              {item.summary && <p>{item.summary}</p>}
            </header>
            {ticketProposals.length > 0 && (
              <div className="assistant-ticket-proposals">
                {ticketProposals.map((row) => (
                  <details key={row.index} className="assistant-ticket-proposal">
                    <summary>
                      <strong>Boleta {row.index} de {ticketProposals.length} · {row.title || 'Sin título'}</strong>
                      <span>{row.clientName || 'Cliente pendiente'} · {row.date || 'Sin fecha'} · {row.startTime || '—'}–{row.endTime || '—'} · {row.hours || 0} h</span>
                      <small>{row.followUpOf ? `Seguimiento de boleta ${row.followUpOf}` : 'Independiente'} {row.missing?.length ? '· Requiere datos' : '· Lista para confirmar'}</small>
                    </summary>
                    <form className="assistant-ticket-editor" onSubmit={(event) => submitRevision(event, item, row)}>
                      <div className="assistant-ticket-editor__grid">
                        {TICKET_PROPOSAL_FIELDS.map(([field, label]) => (
                          <label key={field}>
                            <span>{label}</span>
                            {['reason', 'tests', 'result', 'recommendations'].includes(field) ? (
                              <textarea
                                rows={2}
                                value={fieldValue(item, row, field)}
                                disabled={busy || status !== 'PENDING'}
                                onChange={(event) => setField(item, row, field, event.target.value)}
                              />
                            ) : (
                              <input
                                type="text"
                                value={fieldValue(item, row, field)}
                                disabled={busy || status !== 'PENDING'}
                                onChange={(event) => setField(item, row, field, event.target.value)}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                      {status === 'PENDING' && (
                        <button type="submit" className="button button--secondary button--compact"
                          disabled={busy || !Object.keys(ticketDrafts[item.operationId]?.[row.index] || {}).length}>
                          <Icon name="save" /> Guardar correcciones
                        </button>
                      )}
                    </form>
                  </details>
                ))}
              </div>
            )}
            {!ticketProposals.length && Array.isArray(item.items) && item.items.length > 0 && (
              <div className="assistant-confirmation-items">
                {item.items.slice(0, 12).map((row, index) => (
                  <div key={`${item.operationId}-${index}`}>
                    <strong>{row.name || row.title || `Elemento ${index + 1}`}</strong>
                    <span>{[row.type, row.zone, row.mimeType].filter(Boolean).join(' · ')}</span>
                  </div>
                ))}
                {item.items.length > 12 && <small>+ {item.items.length - 12} elementos adicionales</small>}
              </div>
            )}
            {Array.isArray(result.created) && result.created.length > 0 && (
              <div className="assistant-ticket-created" aria-label="Boletas creadas">
                <strong>Boletas guardadas en DMS</strong>
                {result.created.map((row) => (
                  <Link key={row.id} to={`/boletas/${encodeURIComponent(row.id)}`}>
                    <Icon name="description" /> Boleta #{row.number} · {row.client || 'Cliente'} {row.followUpOf ? `· Seguimiento de ${row.followUpOf}` : '· Independiente'}
                  </Link>
                ))}
              </div>
            )}
            {terminal || partial ? (
              <div className={`assistant-operation-status ${partial ? 'is-partial' : status === 'COMMITTED' ? 'is-success' : 'is-neutral'}`}>
                <Icon name={partial ? 'warning' : status === 'COMMITTED' ? 'check_circle' : 'info'} />
                <span>
                  {status === 'COMMITTED' && 'Operación completada.'}
                  {status === 'CANCELLED' && 'Operación cancelada.'}
                  {status === 'EXPIRED' && 'La confirmación expiró.'}
                  {status === 'FAILED' && 'La operación falló.'}
                  {partial && `Resultado parcial: ${Number(result.createdCount ?? result.uploadedCount ?? 0)} correctos, ${Number(result.failedCount ?? 0)} pendientes.`}
                </span>
              </div>
            ) : null}
            <footer>
              {status === 'PENDING' && (
                <>
                  <button className="button button--primary button--compact" type="button" disabled={busy} onClick={() => onDecision(item, 'confirm')}>
                    <Icon name={busy ? 'progress_activity' : 'check'} /> {item.confirmLabel || 'Confirmar'}
                  </button>
                  <button className="button button--secondary button--compact" type="button" disabled={busy} onClick={() => onDecision(item, 'cancel')}>
                    <Icon name="close" /> {item.cancelLabel || 'Cancelar'}
                  </button>
                </>
              )}
              {partial && (
                <button className="button button--secondary button--compact" type="button" disabled={busy} onClick={() => onDecision(item, 'retry')}>
                  <Icon name={busy ? 'progress_activity' : 'refresh'} /> Reintentar pendientes
                </button>
              )}
              {item.operationId && !['CANCELLED', 'EXPIRED'].includes(status) && (
                <button className="button button--secondary button--compact" type="button" disabled={busy} onClick={() => onStatus(item)}>
                  <Icon name="search" /> Consultar estado
                </button>
              )}
              {status === 'COMMITTING' && <small>Procesando la confirmación. Consulte el estado antes de repetir.</small>}
              {item.expiresAt && status === 'PENDING' && <small>Confirmación temporal y ligada a esta sesión.</small>}
            </footer>
          </section>
        );
      })}
    </div>
  );
}

function AssistantSourceLink({ source }) {
  const documentSource = /^knowledge_document(?:_chunk)?$/.test(String(source.type || ''));
  const content = (
    <>
      <Icon name={sourceIcon(source.type)} />
      <span>
        {source.label}
        {documentSource && <small>Documento interno DMS · Abrir documento</small>}
      </span>
      <Icon name="chevron_right" />
    </>
  );
  if (/^https:\/\//i.test(source.url || '') || String(source.url || '').startsWith('/api/')) {
    return <a href={source.url} target="_blank" rel="noreferrer">{content}</a>;
  }
  if (String(source.url || '').startsWith('/')) return <Link to={source.url}>{content}</Link>;
  return <span className="assistant-source-static">{content}</span>;
}

function AssistantMessage({ message, onSuggestion, onOption, onDecision, onRevise, onStatus, busyOperationId }) {
  const assistant = message.role === 'assistant';
  return (
    <article className={`assistant-message assistant-message--${message.role}`}>
      <div className="assistant-message__avatar"><Icon name={assistant ? 'smart_toy' : 'person'} /></div>
      <div className="assistant-message__content">
        <div className="assistant-message__bubble">
          <AssistantMarkdown value={message.text} messageId={message.id} />
        </div>

        {message.sensitive && <div className="assistant-sensitive-notice"><Icon name="shield_lock" /><span>Esta respuesta contiene información sensible. No se guardará en el historial local del navegador. Oculte la pantalla antes de compartir o proyectar el dispositivo.</span></div>}

        {message.options?.length > 0 && (
          <div className="assistant-choice-list" aria-label="Opciones para aclarar la consulta">
            {message.options.map((option) => (
              <button key={`${option.type}-${option.value}`} type="button" onClick={() => onOption(message, option)}>
                <Icon name="business" />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}

        <AssistantStats stats={message.stats} />
        {message.tables?.map((table) => <AssistantDataTable key={table.id} table={table} />)}
        <AssistantUserFiles files={message.userFiles || []} />
        <AssistantEntities entities={message.entities || []} />
        <AssistantAttachments attachments={message.attachments || []} />
        <AssistantConfirmations confirmations={message.confirmations || []} busyOperationId={busyOperationId} onDecision={onDecision} onRevise={onRevise} onStatus={onStatus} />

        {message.sources?.length > 0 && (
          <div className="assistant-sources">
            <span className="assistant-sources__title"><Icon name="source" /> Fuentes consultadas</span>
            <div>
              {message.sources.map((source) => (
                <AssistantSourceLink key={`${source.type}-${source.id}-${source.url}`} source={source} />
              ))}
            </div>
          </div>
        )}

        {message.suggestions?.length > 0 && (
          <div className="assistant-suggestions">
            {message.suggestions.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => onSuggestion(suggestion)}>{suggestion}</button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default function AssistantPageSecure() {
  const { user, sessionToken, hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const userId = user?.UsuarioID || user?.id || 'user';
  const messagesKey = storageKey(userId, 'messages');
  const contextKey = storageKey(userId, 'context');
  const conversationKey = storageKey(userId, 'conversation');
  const [messages, setMessages] = useState(() => {
    const stored = readJson(messagesKey, []);
    return Array.isArray(stored) && stored.length ? stored.filter((item) => !item.sensitive).slice(-40) : [initialMessage()];
  });
  const [context, setContext] = useState(() => readJson(contextKey, {}));
  const [conversationId] = useState(() => safeStorageGet(conversationKey) || messageId());
  const [input, setInput] = useState('');
  const [dictating, setDictating] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechSupported] = useState(() => Boolean(
    typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  ));
  const [recordingSupported] = useState(() => Boolean(
    typeof window !== 'undefined' && window.MediaRecorder
      && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
  ));
  const [audioTranscribing, setAudioTranscribing] = useState(false);
  const [recordingStarting, setRecordingStarting] = useState(false);
  const recordingRef = useRef(null);
  const recordingSessionRef = useRef(0);
  const transcriptionAbortRef = useRef(null);
  const [microphonePermission, setMicrophonePermission] = useState('prompt');
  const [microphoneRequesting, setMicrophoneRequesting] = useState(false);
  const [microphoneFeedback, setMicrophoneFeedback] = useState('');
  const [microphoneHelpOpen, setMicrophoneHelpOpen] = useState(false);
  const speechRef = useRef(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [progressLabel, setProgressLabel] = useState(ASSISTANT_PROGRESS_STATES[0]);
  const [busyOperationId, setBusyOperationId] = useState('');
  const endRef = useRef(null);
  const fileInputRef = useRef(null);
  const fromRoute = searchParams.get('from') || '';
  const pageContext = useMemo(() => pageContextFromRoute(fromRoute), [fromRoute]);
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');

  // El estado de permisos es informativo; el navegador decide si puede solicitarlo.
  // Consultarlo nunca abre el micrófono ni muestra una petición automática de acceso.
  useEffect(() => {
    let active = true;
    let permissionStatus = null;

    async function refreshMicrophonePermission() {
      if (!navigator.permissions?.query) return;
      try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (!active) return;
        if (permissionStatus) permissionStatus.onchange = null;
        permissionStatus = status;
        setMicrophonePermission(status.state);
        status.onchange = () => {
          if (!active) return;
          setMicrophonePermission(status.state);
          if (status.state === 'granted') setMicrophoneHelpOpen(false);
        };
      } catch {
        // Safari y algunos navegadores no admiten consultar este permiso.
      }
    }

    function refreshOnReturn() {
      if (document.visibilityState === 'visible') refreshMicrophonePermission();
    }

    refreshMicrophonePermission();
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      active = false;
      if (permissionStatus) permissionStatus.onchange = null;
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, []);

  async function requestMicrophonePermission() {
    if (sending || dictating || microphoneRequesting) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMicrophoneFeedback('El navegador no permite solicitar el micrófono aquí. Abra DMS por HTTPS y revise los permisos del dispositivo.');
      setMicrophoneHelpOpen(true);
      return;
    }

    setMicrophoneRequesting(true);
    setMicrophoneFeedback('');
    let stream;
    try {
      // Se solicita solo tras pulsar el botón; la captura de prueba se cierra inmediatamente.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicrophonePermission('granted');
      setMicrophoneHelpOpen(false);
      setMicrophoneFeedback(recordingSupported
        ? 'Micrófono autorizado. Pulse «Iniciar dictado» para grabar y detenga la grabación para transcribirla.'
        : speechSupported
          ? 'Micrófono autorizado. Pulse «Iniciar dictado» para utilizar el reconocimiento del navegador.'
          : 'Micrófono autorizado, pero el navegador no permite grabar ni reconocer voz. Use el micrófono del teclado.');
    } catch (permissionError) {
      const code = String(permissionError?.name || '');
      if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(code)) {
        setMicrophonePermission('denied');
        setMicrophoneFeedback('Acceso al micrófono bloqueado o rechazado. Revise los permisos del sitio y vuelva a intentarlo.');
      } else if (code === 'NotFoundError' || code === 'DevicesNotFoundError') {
        setMicrophoneFeedback('No se encontró un micrófono. Conecte uno o revise el dispositivo.');
      } else if (code === 'NotReadableError' || code === 'TrackStartError') {
        setMicrophoneFeedback('El micrófono está ocupado o no se puede utilizar. Cierre otras aplicaciones que lo estén usando.');
      } else {
        setMicrophoneFeedback('No se pudo comprobar el micrófono. Revise el navegador y los permisos del dispositivo.');
      }
      setMicrophoneHelpOpen(true);
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setMicrophoneRequesting(false);
    }
  }

  // SpeechRecognition solo entrega texto; no almacenamos audio ni enviamos dictados automáticamente.
  useEffect(() => () => {
    const recognition = speechRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
    speechRef.current = null;
    recordingSessionRef.current += 1;
    transcriptionAbortRef.current?.abort();
    const capture = recordingRef.current;
    if (capture) {
      capture.cancelled = true;
      window.clearTimeout(capture.timer);
      if (capture.recorder.state === 'recording') capture.recorder.stop();
      capture.stream.getTracks().forEach((track) => track.stop());
      recordingRef.current = null;
    }
  }, []);

  function endDictation(cancel = false) {
    const capture = recordingRef.current;
    if (capture) {
      if (cancel) {
        capture.cancelled = true;
        recordingSessionRef.current += 1;
      }
      window.clearTimeout(capture.timer);
      if (capture.recorder.state === 'recording') {
        if (!cancel) setAudioTranscribing(true);
        capture.recorder.stop();
      }
      if (cancel) {
        capture.stream.getTracks().forEach((track) => track.stop());
        recordingRef.current = null;
      }
      setDictating(false);
      setInterimTranscript('');
      return;
    }
    if (recordingStarting && cancel) {
      recordingSessionRef.current += 1;
      setRecordingStarting(false);
      setDictating(false);
      return;
    }
    if (audioTranscribing && cancel) {
      recordingSessionRef.current += 1;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      setAudioTranscribing(false);
      return;
    }
    const recognition = speechRef.current;
    if (!recognition) return;
    if (cancel) {
      // Cancelar aborta la captura y descarta los resultados provisionales.
      speechRef.current = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      setInterimTranscript('');
    } else {
      // stop() puede entregar el último resultado FINAL de forma asíncrona.
      // No desconectamos onresult hasta onend, para no perder las últimas palabras.
      recognition.stop();
    }
    setDictating(false);
  }

  async function startRecordedDictation() {
    if (sending || dictating || recordingStarting || audioTranscribing || microphoneRequesting
      || recordingRef.current || speechRef.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Este navegador no permite grabar audio. Abra DMS por HTTPS o use el micrófono del teclado.');
      setMicrophoneHelpOpen(true);
      return;
    }
    const session = ++recordingSessionRef.current;
    setError('');
    setMicrophoneFeedback('');
    setRecordingStarting(true);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== recordingSessionRef.current) return;
      setMicrophonePermission('granted');
      const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
      const selected = formats.find((mimeType) => window.MediaRecorder.isTypeSupported?.(mimeType));
      const recorder = new window.MediaRecorder(stream, selected ? { mimeType: selected } : undefined);
      const chunks = [];
      const capture = { recorder, stream, chunks, session, cancelled: false, timer: null };
      recordingRef.current = capture;
      recorder.ondataavailable = (event) => {
        if (!capture.cancelled && session === recordingSessionRef.current && event.data?.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (session !== recordingSessionRef.current) return;
        capture.cancelled = true;
        window.clearTimeout(capture.timer);
        stream.getTracks().forEach((track) => track.stop());
        recordingRef.current = null;
        setDictating(false);
        setError('El navegador interrumpió la grabación. Revise el micrófono y vuelva a intentarlo.');
      };
      recorder.onstop = async () => {
        window.clearTimeout(capture.timer);
        stream.getTracks().forEach((track) => track.stop());
        if (recordingRef.current === capture) recordingRef.current = null;
        setDictating(false);
        if (capture.cancelled || session !== recordingSessionRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
        if (blob.size < 200 || blob.size > MAX_VOICE_RECORDING_BYTES) {
          setAudioTranscribing(false);
          setError('La grabación está vacía o supera 3 MB. Intente con un audio más corto.');
          return;
        }
        const controller = new AbortController();
        transcriptionAbortRef.current = controller;
        setAudioTranscribing(true);
        try {
          const result = await apiRequest('assistant.chat', {
            assistantAction: 'speech.transcribe',
            mimeType: blob.type.split(';')[0],
            audioBase64: await blobBase64(blob),
          }, sessionToken, { cache: 'no-store', signal: controller.signal });
          if (session !== recordingSessionRef.current) return;
          const transcript = String(result?.transcript || '').trim();
          if (!transcript) throw new Error('No se detectaron palabras en el audio.');
          setInput((current) => (current + (current && !/\s$/.test(current) ? ' ' : '') + transcript).slice(0, 5000));
          setMicrophoneFeedback('Dictado transcrito. Puede revisar el texto antes de enviarlo.');
        } catch (voiceError) {
          if (session === recordingSessionRef.current) {
            setError(voiceError?.message || 'No se pudo transcribir el audio. Intente nuevamente.');
          }
        } finally {
          if (transcriptionAbortRef.current === controller) transcriptionAbortRef.current = null;
          if (session === recordingSessionRef.current) setAudioTranscribing(false);
        }
      };
      recorder.start();
      setDictating(true);
      capture.timer = window.setTimeout(() => {
        if (recordingRef.current === capture && recorder.state === 'recording') recorder.stop();
      }, MAX_VOICE_RECORDING_MS);
    } catch (recordError) {
      if (session === recordingSessionRef.current) {
        const name = String(recordError?.name || '');
        if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) {
          setMicrophonePermission('denied');
          setError('El navegador o el sistema bloquearon la captura de audio. Revise el permiso del sitio y el permiso de micrófono del dispositivo.');
        } else if (['NotFoundError', 'DevicesNotFoundError'].includes(name)) {
          setError('No se encontró un micrófono. Compruebe que esté conectado y habilitado en el sistema.');
        } else if (['NotReadableError', 'TrackStartError'].includes(name)) {
          setError('No se pudo abrir el micrófono. Puede estar ocupado por otra aplicación o bloqueado por Windows.');
        } else if (name === 'NotSupportedError') {
          setError('El formato de grabación de este navegador no es compatible. Pruebe Chrome, Edge o Safari actualizados.');
        } else {
          setError('El navegador no pudo iniciar la grabación. Compruebe el micrófono y los controles del sitio.');
        }
        setMicrophoneHelpOpen(true);
      }
    } finally {
      if (stream && recordingRef.current?.stream !== stream) stream.getTracks().forEach((track) => track.stop());
      if (session === recordingSessionRef.current) setRecordingStarting(false);
    }
  }

  // Una sola acción visible: grabación real primero, sin depender del servicio
  // SpeechRecognition de Chrome (su permiso es independiente de getUserMedia).
  function startDictation() {
    if (recordingSupported) {
      void startRecordedDictation();
      return;
    }
    if (!speechSupported) {
      setError('Este navegador no permite grabar ni reconocer voz. Abra DMS con HTTPS en Chrome, Edge o Safari, o use el dictado del teclado.');
      setMicrophoneHelpOpen(true);
      return;
    }
    startNativeDictation();
  }

  function startNativeDictation() {
    if (sending || speechRef.current || recordingRef.current || recordingStarting || audioTranscribing) return;
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      setError('El reconocimiento de voz no está disponible en este navegador.');
      return;
    }
    setError('');
    const recognition = new Constructor();
    const handledFinals = new Set();
    recognition.lang = 'es-CR';
    recognition.interimResults = true;
    // Safari y Chrome móvil pueden detener el reconocimiento por su cuenta.
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (speechRef.current !== recognition) return;
      let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const segment = String(event.results[i]?.[0]?.transcript || '').trim();
        if (!segment) continue;
        if (event.results[i].isFinal) {
          if (!handledFinals.has(i)) {
            handledFinals.add(i);
            setInput((current) => {
              const separator = current && !/\s$/.test(current) ? ' ' : '';
              return (current + separator + segment).slice(0, 5000);
            });
          }
        } else {
          interim += (interim ? ' ' : '') + segment;
        }
      }
      setInterimTranscript(interim);
    };
    recognition.onerror = (event) => {
      if (speechRef.current !== recognition) return;
      const code = String(event.error || '');
      if (['not-allowed', 'service-not-allowed'].includes(code)) {
        setError(recordingSupported
          ? 'El reconocimiento de voz fue rechazado por el navegador. Pruebe «Grabar con Gemini».'
          : 'El reconocimiento de voz fue rechazado. Revise los permisos o use el teclado.');
        setMicrophoneHelpOpen(true);
      } else if (code === 'audio-capture') {
        setError('No se detectó un micrófono disponible.');
      } else if (code !== 'no-speech' && code !== 'aborted') {
        setError(recordingSupported
          ? 'No se pudo usar el dictado del navegador. Pruebe «Grabar con Gemini».'
          : 'No fue posible reconocer la voz. Revise la conexión o escriba el mensaje.');
      }
      speechRef.current = null;
      setInterimTranscript('');
      setDictating(false);
    };
    recognition.onend = () => {
      if (speechRef.current !== recognition) return;
      speechRef.current = null;
      setInterimTranscript('');
      setDictating(false);
    };
    try {
      speechRef.current = recognition;
      recognition.start(); // Solo tras un clic explícito del usuario.
      setDictating(true);
    } catch {
      speechRef.current = null;
      setDictating(false);
      setError(recordingSupported
        ? 'No se pudo iniciar el reconocimiento de voz. Pruebe «Grabar con Gemini».'
        : 'No se pudo activar el micrófono. Intente nuevamente o escriba el mensaje.');
    }
  }

  useEffect(() => { safeStorageSet(conversationKey, conversationId); }, [conversationId, conversationKey]);
  useEffect(() => {
    const safeMessages = messages.filter((item) => !item.sensitive);
    const persistableMessages = safeMessages
      .slice(-40)
      .map((item) => ({
        ...item,
        attachments: [],
        sources: Array.isArray(item.sources)
          ? item.sources.map((source) => (
            /^knowledge_document(?:_chunk)?$/.test(String(source?.type || ''))
              ? {
                ...source,
                url: source.articleId ? `/conocimiento/${encodeURIComponent(source.articleId)}` : '',
              }
              : source
          ))
          : [],
      }));
    safeStorageSet(messagesKey, JSON.stringify(persistableMessages));
  }, [messages, messagesKey]);
  useEffect(() => { safeStorageSet(contextKey, JSON.stringify(context)); }, [context, contextKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);
  useEffect(() => {
    if (!sending) {
      setElapsedSeconds(0);
      setProgressLabel(ASSISTANT_PROGRESS_STATES[0]);
      return undefined;
    }
    const started = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsedSeconds(seconds);
      const index = seconds < 5 ? 0 : seconds < 15 ? 1 : seconds < 35 ? 2 : 3;
      setProgressLabel(ASSISTANT_PROGRESS_STATES[index]);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sending]);
  useEffect(() => () => {
    pendingFiles.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  function historyForRequest(nextMessages) {
    return nextMessages
      .filter((item) => !item.sensitive && (item.role === 'user' || item.role === 'assistant'))
      .slice(-8)
      .map((item) => ({ role: item.role, text: item.text }));
  }

  async function sendQuestion(rawQuestion, contextPatch = {}, options = {}) {
    const includePendingFiles = options.includePendingFiles === true;
    const files = includePendingFiles ? pendingFiles : [];
    const typedQuestion = String(rawQuestion || '').trim();
    const question = typedQuestion || (files.length ? 'Analiza los archivos adjuntos.' : '');
    if (!question || sendingRef.current) return;
    // Bloqueo síncrono: evita dobles envíos antes de que React actualice sending.
    sendingRef.current = true;

    const nextContext = { ...context, ...contextPatch, pageContext };
    setInput('');
    setError('');
    setSending(true);

    try {
      const uploadedFiles = [];
      for (const item of files) {
        setProgressLabel(`Cargando ${item.file.name}…`);
        uploadedFiles.push(await uploadAssistantAttachment(item, sessionToken));
      }

      const userMessage = {
        id: messageId(),
        role: 'user',
        text: question,
        userFiles: uploadedFiles,
        sensitive: false,
      };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setProgressLabel('Analizando solicitud…');

      const response = await apiRequest('assistant.chat', {
        message: question,
        conversationId,
        history: historyForRequest(nextMessages.slice(0, -1)),
        context: nextContext,
        attachmentIds: uploadedFiles.map((item) => item.uploadId),
      }, sessionToken, { cache: 'no-store' });
      const presentation = buildPresentation(response.facts || {});
      const assistantMessage = {
        id: messageId(),
        role: 'assistant',
        text: response.answer || response.message || 'No se recibió una respuesta.',
        type: response.type || 'answer',
        sources: Array.isArray(response.sources) ? response.sources : [],
        entities: Array.isArray(response.entities) ? response.entities : [],
        attachments: Array.isArray(response.attachments) ? response.attachments : [],
        options: Array.isArray(response.options) ? response.options : [],
        suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
        confirmations: Array.isArray(response.confirmations) ? response.confirmations : [],
        resumeQuestion: response.resumeQuestion || question,
        tables: presentation.tables,
        stats: presentation.stats,
        sensitive: Boolean(response.sensitive),
      };
      setMessages((current) => [...current, assistantMessage]);
      if (files.length) {
        files.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        setPendingFiles([]);
      }
      if (response.context && typeof response.context === 'object') setContext(response.context);
    } catch (requestError) {
      const message = assistantFailureMessage(requestError);
      setError(message);
      // Conservar el dictado en el editor si la red o Gemini fallaron.
      setInput((current) => current || question);
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', text: message, sources: [], entities: [], attachments: [], confirmations: [], options: [], suggestions: [], tables: [], stats: [], sensitive: false }]);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function addPendingFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const available = Math.max(0, MAX_ASSISTANT_FILES - pendingFiles.length);
    const accepted = [];
    const rejected = [];
    for (const file of incoming.slice(0, available)) {
      if (!assistantFileAllowed(file)) {
        rejected.push(`${file.name}: formato no permitido`);
        continue;
      }
      if (file.size <= 0 || file.size > MAX_ASSISTANT_FILE_BYTES) {
        rejected.push(`${file.name}: debe pesar entre 1 byte y 50 MB`);
        continue;
      }
      accepted.push({
        id: messageId(),
        file,
        previewUrl: String(file.type || '').startsWith('image/') ? URL.createObjectURL(file) : '',
      });
    }
    if (incoming.length > available) rejected.push(`Solo se permiten ${MAX_ASSISTANT_FILES} adjuntos por mensaje.`);
    setPendingFiles((current) => [...current, ...accepted]);
    if (rejected.length) setError(rejected.join(' · '));
    else setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePendingFile(id) {
    setPendingFiles((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function checkOperationStatus(item) {
    if (!item?.operationId || busyOperationId) return;
    setBusyOperationId(item.operationId);
    setError('');
    try {
      const response = await apiRequest('assistant.chat', {
        assistantAction: 'operation.status',
        operationId: item.operationId,
      }, sessionToken, { cache: 'no-store' });
      setMessages((current) => current.map((message) => ({
        ...message,
        confirmations: Array.isArray(message.confirmations)
          ? message.confirmations.map(confirmation => confirmation.operationId === item.operationId
            ? { ...confirmation, ...response, preview: response.preview || confirmation.preview,
                result: response.result || confirmation.result }
            : confirmation)
          : message.confirmations,
      })));
    } catch (error) {
      setError(error?.message || 'No se pudo consultar el estado de la operación.');
    } finally {
      setBusyOperationId('');
    }
  }

  async function reviseOperation(item, index, fields) {
    if (!item?.operationId || busyOperationId) return false;
    setBusyOperationId(item.operationId);
    setError('');
    try {
      const response = await apiRequest('assistant.chat', {
        assistantAction: 'operation.revise',
        operationId: item.operationId,
        index,
        fields,
      }, sessionToken, { cache: 'no-store' });
      if (response.needsInput) {
        setError((response.issues || []).map(issue => `Boleta ${issue.index}: ${issue.missing.join(', ')}`).join(' · ') || 'Revise los campos indicados.');
        return false;
      }
      setMessages((current) => current.map((message) => ({
        ...message,
        confirmations: Array.isArray(message.confirmations)
          ? message.confirmations.map(confirmation => confirmation.operationId === item.operationId
            ? { ...confirmation, ...response, preview: response.preview }
            : confirmation)
          : message.confirmations,
      })));
      return true;
    } catch (error) {
      setError(error?.message || 'No se pudieron guardar las correcciones.');
      return false;
    } finally {
      setBusyOperationId('');
    }
  }

  async function decideOperation(item, decision) {
    if (!item?.operationId || busyOperationId) return;
    setBusyOperationId(item.operationId);
    setError('');
    try {
      const response = await apiRequest('assistant.chat', {
        assistantAction: 'operation.decide',
        operationId: item.operationId,
        decision,
      }, sessionToken, { cache: 'no-store' });
      const updated = { ...item, ...response, preview: response?.preview || item.preview, result: response?.result || {} };
      setMessages((current) => current.map((message) => ({
        ...message,
        confirmations: Array.isArray(message.confirmations)
          ? message.confirmations.map((confirmation) => confirmation.operationId === item.operationId ? updated : confirmation)
          : message.confirmations,
      })));
      setContext((current) => ({ ...current, pendingOperationId: item.operationId }));
      const status = String(response?.status || '').toUpperCase();
      if (status === 'COMMITTED') {
        setMessages((current) => [...current, {
          id: messageId(),
          role: 'assistant',
          text: 'Operación confirmada y completada por el backend de DMS.',
          sources: [], entities: [], attachments: [], confirmations: [], options: [], suggestions: [], tables: [], stats: [], sensitive: false,
        }]);
      } else if (status === 'PARTIAL') {
        const result = response?.result || {};
        setMessages((current) => [...current, {
          id: messageId(),
          role: 'assistant',
          text: `La operación quedó parcial: ${Number(result.createdCount ?? result.uploadedCount ?? 0)} elementos correctos y ${Number(result.failedCount ?? 0)} pendientes. Puede usar “Reintentar pendientes”.`,
          sources: [], entities: [], attachments: [], confirmations: [], options: [], suggestions: [], tables: [], stats: [], sensitive: false,
        }]);
      } else if (status === 'CANCELLED') {
        setMessages((current) => [...current, {
          id: messageId(),
          role: 'assistant',
          text: 'Operación cancelada. No se aplicaron nuevos cambios desde esta confirmación.',
          sources: [], entities: [], attachments: [], confirmations: [], options: [], suggestions: [], tables: [], stats: [], sensitive: false,
        }]);
      }
    } catch (operationError) {
      // Nunca repetir COMMIT a ciegas. Consultar el estado persistido con la
      // operación existente; si tampoco responde, permitir revisión manual.
      if (operationError?.code === 'UNKNOWN_RESULT' || operationError?.code === 'REQUEST_TIMEOUT'
        || [502, 503, 504].includes(Number(operationError?.status))) {
        try {
          const statusResponse = await apiRequest('assistant.chat', {
            assistantAction: 'operation.status',
            operationId: item.operationId,
          }, sessionToken, { cache: 'no-store' });
          setMessages((current) => current.map((message) => ({
            ...message,
            confirmations: Array.isArray(message.confirmations)
              ? message.confirmations.map((confirmation) => confirmation.operationId === item.operationId
                ? { ...confirmation, ...statusResponse, preview: statusResponse.preview || confirmation.preview,
                    result: statusResponse.result || confirmation.result }
                : confirmation)
              : message.confirmations,
          })));
          setError('La confirmación perdió su respuesta. Se consultó el estado real del servidor; revise el resultado antes de continuar.');
        } catch {
          setError('No fue posible verificar la confirmación. Use «Consultar estado» cuando vuelva la conexión. No repita la confirmación a ciegas.');
        }
      } else {
        setError(assistantFailureMessage(operationError));
      }
    } finally {
      setBusyOperationId('');
    }
  }

  function chooseOption(message, option) {
    const patch = option.type === 'client'
      ? { lastClientId: option.value, lastClientName: option.label }
      : {};
    sendQuestion(`Me refiero a ${option.label}. ${message.resumeQuestion || 'Continúe con la consulta.'}`, patch);
  }

  function clearConversation() {
    if (!window.confirm('¿Desea limpiar la conversación y el contexto del asistente?')) return;
    endDictation(true);
    transcriptionAbortRef.current?.abort();
    recordingSessionRef.current += 1;
    setAudioTranscribing(false);
    const cleanMessages = [initialMessage()];
    setMessages(cleanMessages);
    setContext({});
    setInput('');
    pendingFiles.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setPendingFiles([]);
    setError('');
    safeStorageRemove(messagesKey);
    safeStorageRemove(contextKey);
  }

  function submit(event) {
    event.preventDefault();
    if (!dictating && !audioTranscribing && !recordingStarting) sendQuestion(input, {}, { includePendingFiles: true });
  }

  function handleKeyDown(event) {
    if (!dictating && !audioTranscribing && !recordingStarting && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendQuestion(input, {}, { includePendingFiles: true });
    }
  }

  return (
    <div className="page assistant-page">
      <header className="assistant-header">
        <div className="assistant-header__identity">
          <div className="assistant-header__bot"><Icon name="smart_toy" /></div>
          <div>
            <span className="eyebrow">Consulta interna con IA</span>
            <h1>Asistente DMS</h1>
            <p>Consulta boletas, mantenimientos, dispositivos, clientes, técnicos, casos y conocimiento interno usando lenguaje natural.</p>
          </div>
        </div>
        <button className="button button--secondary button--compact" type="button" onClick={clearConversation} disabled={sending}>
          <Icon name="delete_sweep" /> Limpiar
        </button>
      </header>

      <section className="assistant-safety-note">
        <Icon name="verified_user" />
        <div>
          <strong>Respuestas basadas en datos internos y permisos</strong>
          <span>El backend aplica su sesión y permisos antes de consultar PostgreSQL o Drive; los secretos no se envían a Gemini. El agente nunca recibe contraseñas, tokens ni credenciales técnicas. {isAdmin ? 'Como administrador, también puede consultar casos y estadísticas autorizadas.' : 'Solo se mostrarán los datos que ya puede consultar desde DMS.'}</span>
        </div>
      </section>

      {fromRoute && (
        <div className="assistant-page-context">
          <Icon name="link" />
          <span>Se usará como contexto la pantalla desde la que abrió el asistente.</span>
        </div>
      )}

      <section className="assistant-chat" aria-live="polite">
        <div className="assistant-chat__messages">
          {messages.map((message) => (
            <AssistantMessage key={message.id} message={message} onSuggestion={sendQuestion} onOption={chooseOption} onDecision={decideOperation} onRevise={reviseOperation} onStatus={checkOperationStatus} busyOperationId={busyOperationId} />
          ))}
          {sending && (
            <article className="assistant-message assistant-message--assistant assistant-message--typing">
              <div className="assistant-message__avatar"><Icon name="smart_toy" /></div>
              <div className="assistant-message__content"><div className="assistant-message__bubble" role="status"><Icon name="progress_activity" /><span>{progressLabel} <small className="assistant-message__elapsed">({elapsedSeconds} s)</small></span></div></div>
            </article>
          )}
          <div ref={endRef} />
        </div>

        <form className="assistant-composer" onSubmit={submit} data-no-draft>
          {error && <span className="assistant-composer__error" role="alert"><Icon name="error" />{error}</span>}
          {pendingFiles.length > 0 && (
            <div className="assistant-pending-files">
              {pendingFiles.map((item) => (
                <article key={item.id}>
                  {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <Icon name="draft" />}
                  <span><strong>{item.file.name}</strong><small>{humanFileSize(item.file.size)} · {item.file.type || 'archivo'}</small></span>
                  <button type="button" onClick={() => removePendingFile(item.id)} disabled={sending} aria-label={`Eliminar ${item.file.name}`}><Icon name="close" /></button>
                </article>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            className="assistant-file-input"
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={(event) => addPendingFiles(event.target.files)}
            disabled={sending}
          />
          {(dictating || recordingStarting || audioTranscribing) && <div className="assistant-dictation-status" role="status">
            <Icon name="mic" />
            <span>{audioTranscribing ? 'Transcribiendo audio con Gemini…' : recordingStarting
              ? 'Conectando el micrófono…' : recordingRef.current
                ? 'Grabando… pulse el micrófono para transcribir (máximo 90 segundos).' 
                : `Escuchando… ${interimTranscript || 'Hable claramente en español.'}`}</span>
            <button type="button" onClick={() => endDictation(true)}>Cancelar</button>
          </div>}
          <div className="assistant-composer__row">
            <button className="assistant-attach-button" type="button" disabled={sending || pendingFiles.length >= MAX_ASSISTANT_FILES} onClick={() => fileInputRef.current?.click()} title="Adjuntar imágenes o documentos">
              <Icon name="attach_file" />
            </button>
            <button
              className={`assistant-attach-button assistant-microphone ${dictating ? 'is-listening' : ''}`}
              type="button"
              disabled={sending || recordingStarting || audioTranscribing}
              aria-label={dictating ? (recordingRef.current ? 'Detener y transcribir grabación' : 'Detener dictado') : 'Iniciar dictado de voz'}
              aria-pressed={dictating}
              title={dictating ? (recordingRef.current ? 'Detener y transcribir grabación' : 'Detener dictado')
                : 'Iniciar dictado (solicita acceso al micrófono si es necesario)'}
              onClick={() => dictating ? endDictation() : startDictation()}
            >
              <Icon name={dictating ? 'stop_circle' : 'mic'} />
            </button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escriba o dicte su mensaje…"
              rows="3"
              maxLength="5000"
              disabled={sending}
              aria-label="Pregunta para el asistente"
            />
            <button className="button button--primary" type="submit" disabled={sending || dictating || audioTranscribing || recordingStarting || (!input.trim() && !pendingFiles.length)} aria-label="Enviar pregunta">
              <Icon name={sending ? 'progress_activity' : 'send'} />
              <span>Enviar</span>
            </button>
          </div>
          <div className="assistant-microphone-access" aria-label="Acceso al micrófono">
            <button type="button" className="assistant-microphone-access__action assistant-microphone-access__action--start"
              onClick={() => dictating ? endDictation() : startDictation()}
              disabled={sending || recordingStarting || audioTranscribing || microphoneRequesting}
              aria-pressed={dictating}>
              <Icon name={dictating ? 'stop_circle' : 'mic'} />
              {dictating ? (recordingRef.current ? 'Detener y transcribir' : 'Detener dictado') : 'Iniciar dictado'}
            </button>
            <button type="button" className="assistant-microphone-access__action"
              onClick={requestMicrophonePermission} disabled={sending || dictating || audioTranscribing || recordingStarting || microphoneRequesting}>
              <Icon name={microphonePermission === 'granted' ? 'check_circle' : 'tune'} />
              {microphoneRequesting ? 'Comprobando…' : microphonePermission === 'granted'
                ? 'Probar acceso' : microphonePermission === 'denied' ? 'Reintentar permiso' : 'Solicitar permiso'}
            </button>
            <button type="button" className="assistant-microphone-access__help"
              aria-expanded={microphoneHelpOpen} aria-controls="assistant-microphone-help"
              onClick={() => setMicrophoneHelpOpen((open) => !open)}>
              <Icon name="help_outline" /> Cómo habilitarlo
            </button>
            <p className="assistant-microphone-access__hint">
              {recordingSupported ? 'Pulse «Iniciar dictado» y hable. Pulse otra vez para transcribir con Gemini.'
                : speechSupported ? 'Pulse «Iniciar dictado» para usar la voz del navegador.'
                  : 'Este navegador no dispone de grabación ni dictado integrado.'}
            </p>
            {microphoneFeedback && <p className="assistant-microphone-access__feedback" role="status">{microphoneFeedback}</p>}
            {microphoneHelpOpen && (
              <div className="assistant-microphone-access__instructions" id="assistant-microphone-help">
                <p><strong>Diagnóstico local:</strong> HTTPS seguro: {window.isSecureContext ? 'Sí' : 'No'} · Grabación: {recordingSupported ? 'Disponible' : 'No disponible'} · Reconocimiento nativo: {speechSupported ? 'Disponible' : 'No disponible'} · Permiso: {microphonePermission === 'granted' ? 'Concedido' : microphonePermission === 'denied' ? 'Bloqueado' : 'Sin confirmar'}.</p>
                <p>El permiso solo lo concede el navegador. Si está bloqueado, la app no puede activarlo automáticamente:</p>
                <p><strong>PC (Chrome/Edge):</strong> abra los controles del sitio junto a la dirección, cambie Micrófono a Permitir y vuelva a cargar la página.</p>
                <p><strong>Android:</strong> revise el permiso de micrófono de Chrome y del sitio en Configuración, Permisos o Configuración de sitios.</p>
                <p><strong>iPhone/iPad:</strong> revise el menú del sitio de Safari y sus permisos de micrófono en Ajustes. En otros navegadores, revise los permisos de la app en Ajustes.</p>
                {!speechSupported && <p>Este navegador no ofrece reconocimiento de voz nativo en DMS. {recordingSupported ? 'Use el botón de micrófono para grabar y transcribir con Gemini.' : 'Use el micrófono del teclado del teléfono.'}</p>}
              </div>
            )}
          </div>
          <small>
            Puede dictar y corregir el texto antes de enviarlo.{' '}
            {!speechSupported && !recordingSupported && 'Para dictar, use el micrófono del teclado del dispositivo. '}
            El dictado nativo puede utilizar servicios del navegador. Cuando existe grabación, el audio se transmite al backend de DMS y a Gemini para transcribirse, sin almacenamiento permanente de audio.
            Los adjuntos y las respuestas mantienen sus permisos actuales.
          </small>
        </form>
      </section>
    </div>
  );
}