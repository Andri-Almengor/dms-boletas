import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import GatewaySnapshotCard from '../../components/assistant/GatewaySnapshotCard';
import '../../styles/assistant-sensitive.css';

const STARTER_QUESTIONS = [
  '¿Qué pasó esta semana en RN?',
  '¿Cuál fue la última boleta de Asamblea?',
  'Dame las credenciales de cámaras de Asamblea',
  '¿Cuántos casos activos quedan sin asignar?',
  '¿Cómo se instala MorphoManager?',
];

function storageKey(userId, suffix) {
  return `dms_assistant_${suffix}_${userId || 'user'}`;
}

function initialMessage() {
  return {
    id: 'welcome',
    role: 'assistant',
    text: 'Puede preguntarme por boletas, mantenimientos, dispositivos, clientes, casos, tutoriales y credenciales autorizadas. También entiendo abreviaciones como RN, Asamblea, BCR o AFZ. Cuando una consulta sea ambigua, le pediré el dato que falta.',
    sources: [],
    options: [],
    suggestions: STARTER_QUESTIONS,
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
  if (type === 'ticket') return 'description';
  if (type === 'surveys') return 'reviews';
  if (type === 'catalog') return 'inventory_2';
  if (type === 'credentials') return 'shield_lock';
  if (type === 'cases') return 'support_agent';
  return 'engineering';
}

function AssistantMessage({ message, onSuggestion, onOption }) {
  const assistant = message.role === 'assistant';
  return (
    <article className={`assistant-message assistant-message--${message.role}`}>
      <div className="assistant-message__avatar"><Icon name={assistant ? 'smart_toy' : 'person'} /></div>
      <div className="assistant-message__content">
        <div className="assistant-message__bubble">
          {String(message.text || '').split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={`${message.id}-${index}`}>{paragraph}</p>)}
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
        {message.snapshot && <GatewaySnapshotCard snapshot={message.snapshot} />}

        {message.sources?.length > 0 && (
          <div className="assistant-sources">
            <span className="assistant-sources__title"><Icon name="source" /> Fuentes consultadas</span>
            <div>
              {message.sources.map((source) => (
                <Link key={`${source.type}-${source.id}-${source.url}`} to={source.url}>
                  <Icon name={sourceIcon(source.type)} />
                  <span>{source.label}</span>
                  <Icon name="chevron_right" />
                </Link>
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
  const endRef = useRef(null);
  const fromRoute = searchParams.get('from') || '';
  const pageContext = useMemo(() => pageContextFromRoute(fromRoute), [fromRoute]);
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');

  useEffect(() => { localStorage.setItem(conversationKey, conversationId); }, [conversationId, conversationKey]);
  useEffect(() => {
    const persistableMessages = messages.filter((item) => !item.sensitive).slice(-40);
    localStorage.setItem(messagesKey, JSON.stringify(persistableMessages));
  }, [messages, messagesKey]);
  useEffect(() => { localStorage.setItem(contextKey, JSON.stringify(context)); }, [context, contextKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

  function historyForRequest(nextMessages) {
    return nextMessages
      .filter((item) => !item.sensitive && (item.role === 'user' || item.role === 'assistant'))
      .slice(-8)
      .map((item) => ({ role: item.role, text: item.text }));
  }

  async function sendQuestion(rawQuestion, contextPatch = {}) {
    const question = String(rawQuestion || '').trim();
    if (!question || sending) return;
    const userMessage = { id: messageId(), role: 'user', text: question, sensitive: false };
    const nextMessages = [...messages, userMessage];
    const nextContext = { ...context, ...contextPatch, pageContext };
    setMessages(nextMessages);
    setInput('');
    setError('');
    setSending(true);

    try {
      const response = await apiRequest('assistant.chat', {
        message: question,
        conversationId,
        history: historyForRequest(nextMessages.slice(0, -1)),
        context: nextContext,
      }, sessionToken);
      const presentation = buildPresentation(response.facts || {});
      const assistantMessage = {
        id: messageId(),
        role: 'assistant',
        text: response.answer || response.message || 'No se recibió una respuesta.',
        type: response.type || 'answer',
        sources: Array.isArray(response.sources) ? response.sources : [],
        options: Array.isArray(response.options) ? response.options : [],
        suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
        resumeQuestion: response.resumeQuestion || question,
        tables: presentation.tables,
        stats: presentation.stats,
        snapshot: response.facts?.gatewaySnapshot || null,
        sensitive: Boolean(response.sensitive),
      };
      setMessages((current) => [...current, assistantMessage]);
      if (response.context && typeof response.context === 'object') setContext(response.context);
    } catch (requestError) {
      const message = requestError?.message || 'No se pudo consultar el asistente.';
      setError(message);
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', text: message, sources: [], options: [], suggestions: [], tables: [], stats: [], sensitive: false }]);
    } finally {
      setSending(false);
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
    setError('');
    localStorage.removeItem(messagesKey);
    localStorage.removeItem(contextKey);
  }

  function submit(event) {
    event.preventDefault();
    sendQuestion(input);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendQuestion(input);
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
            <p>Consulta boletas, mantenimientos, clientes, casos, credenciales autorizadas y la base de conocimientos usando lenguaje natural.</p>
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
          <span>Las consultas de contraseñas se resuelven directamente en el servidor: los secretos no se envían a Gemini y las respuestas sensibles no se guardan en el historial local. {isAdmin ? 'Como administrador, también puede consultar resúmenes de casos y encuestas.' : 'Las funciones administrativas permanecen restringidas.'}</span>
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
            <AssistantMessage key={message.id} message={message} onSuggestion={sendQuestion} onOption={chooseOption} />
          ))}
          {sending && (
            <article className="assistant-message assistant-message--assistant assistant-message--typing">
              <div className="assistant-message__avatar"><Icon name="smart_toy" /></div>
              <div className="assistant-message__content"><div className="assistant-message__bubble"><Icon name="progress_activity" /><span>Consultando la información disponible...</span></div></div>
            </article>
          )}
          <div ref={endRef} />
        </div>

        <form className="assistant-composer" onSubmit={submit} data-no-draft>
          {error && <span className="assistant-composer__error"><Icon name="error" />{error}</span>}
          <div>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ej. Dame las credenciales de cámaras de Asamblea o ¿cuántos casos quedan sin asignar?"
              rows="2"
              maxLength="1200"
              disabled={sending}
              aria-label="Pregunta para el asistente"
            />
            <button className="button button--primary" type="submit" disabled={sending || !input.trim()} aria-label="Enviar pregunta">
              <Icon name={sending ? 'progress_activity' : 'send'} />
              <span>Enviar</span>
            </button>
          </div>
          <small>Las respuestas respetan los permisos de la sesión. Las contraseñas permanecen ocultas hasta que las revele.</small>
        </form>
      </section>
    </div>
  );
}
