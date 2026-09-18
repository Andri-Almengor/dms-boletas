import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import '../../styles/assistant-sensitive.css';

const ASSISTANT_PROGRESS_STATES = [
  'Analizando solicitud…',
  'Consultando DMS…',
  'Buscando evidencias…',
  'Consultando Base de Conocimiento…',
  'Revisando documentación…',
  'Preparando respuesta…',
];

const ASSISTANT_FILE_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt']);
const MAX_ASSISTANT_FILES = 50;
const MAX_ASSISTANT_FILE_BYTES = 50 * 1024 * 1024;

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

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
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
        <article className="assistant-attachment-card" key={`${item.entityId || 'file'}-${index}-${item.title}`}>
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

function AssistantConfirmations({ confirmations = [], busyOperationId, onDecision }) {
  if (!confirmations.length) return null;
  return (
    <div className="assistant-confirmation-list">
      {confirmations.map((item) => {
        const status = String(item.status || 'PENDING').toUpperCase();
        const busy = busyOperationId === item.operationId;
        const result = item.result || {};
        const partial = status === 'PARTIAL';
        const terminal = ['COMMITTED', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(status);
        return (
          <section className="assistant-confirmation-card" key={item.operationId}>
            <header>
              <span><Icon name={status === 'COMMITTED' ? 'check_circle' : partial ? 'warning' : 'fact_check'} /> Operación controlada</span>
              <strong>{item.title || 'Confirmación requerida'}</strong>
              {item.summary && <p>{item.summary}</p>}
            </header>
            {Array.isArray(item.items) && item.items.length > 0 && (
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
              {!terminal && !partial && (
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
              {item.expiresAt && !terminal && <small>Confirmación temporal y ligada a esta sesión.</small>}
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

function AssistantMessage({ message, onSuggestion, onOption, onDecision, busyOperationId }) {
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
        <AssistantConfirmations confirmations={message.confirmations || []} busyOperationId={busyOperationId} onDecision={onDecision} />

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
  const [conversationId] = useState(() => localStorage.getItem(conversationKey) || messageId());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [progressLabel, setProgressLabel] = useState(ASSISTANT_PROGRESS_STATES[0]);
  const [busyOperationId, setBusyOperationId] = useState('');
  const endRef = useRef(null);
  const fileInputRef = useRef(null);
  const fromRoute = searchParams.get('from') || '';
  const pageContext = useMemo(() => pageContextFromRoute(fromRoute), [fromRoute]);
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');

  useEffect(() => { localStorage.setItem(conversationKey, conversationId); }, [conversationId, conversationKey]);
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
    localStorage.setItem(messagesKey, JSON.stringify(persistableMessages));
  }, [messages, messagesKey]);
  useEffect(() => { localStorage.setItem(contextKey, JSON.stringify(context)); }, [context, contextKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);
  useEffect(() => {
    if (!sending) {
      setProgressLabel(ASSISTANT_PROGRESS_STATES[0]);
      return undefined;
    }
    let index = 0;
    setProgressLabel(ASSISTANT_PROGRESS_STATES[0]);
    const timer = window.setInterval(() => {
      index = Math.min(index + 1, ASSISTANT_PROGRESS_STATES.length - 1);
      setProgressLabel(ASSISTANT_PROGRESS_STATES[index]);
    }, 2600);
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
    if (!question || sending) return;

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
      const message = requestError?.message || 'No se pudo consultar el asistente.';
      setError(message);
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', text: message, sources: [], entities: [], attachments: [], confirmations: [], options: [], suggestions: [], tables: [], stats: [], sensitive: false }]);
    } finally {
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
      setError(operationError?.message || 'No se pudo confirmar la operación.');
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
    const cleanMessages = [initialMessage()];
    setMessages(cleanMessages);
    setContext({});
    setInput('');
    pendingFiles.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setPendingFiles([]);
    setError('');
    localStorage.removeItem(messagesKey);
    localStorage.removeItem(contextKey);
  }

  function submit(event) {
    event.preventDefault();
    sendQuestion(input, {}, { includePendingFiles: true });
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
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
            <AssistantMessage key={message.id} message={message} onSuggestion={sendQuestion} onOption={chooseOption} onDecision={decideOperation} busyOperationId={busyOperationId} />
          ))}
          {sending && (
            <article className="assistant-message assistant-message--assistant assistant-message--typing">
              <div className="assistant-message__avatar"><Icon name="smart_toy" /></div>
              <div className="assistant-message__content"><div className="assistant-message__bubble"><Icon name="progress_activity" /><span>{progressLabel}</span></div></div>
            </article>
          )}
          <div ref={endRef} />
        </div>

        <form className="assistant-composer" onSubmit={submit} data-no-draft>
          {error && <span className="assistant-composer__error"><Icon name="error" />{error}</span>}
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
          <div className="assistant-composer__row">
            <button className="assistant-attach-button" type="button" disabled={sending || pendingFiles.length >= MAX_ASSISTANT_FILES} onClick={() => fileInputRef.current?.click()} title="Adjuntar imágenes o documentos">
              <Icon name="attach_file" />
            </button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ej. Dame las credenciales de cámaras de Asamblea o ¿cuántos casos quedan sin asignar?"
              rows="2"
              maxLength="5000"
              disabled={sending}
              aria-label="Pregunta para el asistente"
            />
            <button className="button button--primary" type="submit" disabled={sending || (!input.trim() && !pendingFiles.length)} aria-label="Enviar pregunta">
              <Icon name={sending ? 'progress_activity' : 'send'} />
              <span>Enviar</span>
            </button>
          </div>
          <small>Puede adjuntar imágenes, PDF, DOCX, XLSX, CSV o TXT. Los archivos se cargan de forma privada; para analizarlos, Gemini recibe de forma transitoria la imagen o texto extraído, nunca el DriveFileID, tokens ni credenciales. Las respuestas respetan los permisos de la sesión.</small>
        </form>
      </section>
    </div>
  );
}