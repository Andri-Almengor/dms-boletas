import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';

const STARTER_QUESTIONS = [
  '¿Qué pasó esta semana en RN?',
  '¿Cuál fue la última boleta de Asamblea?',
  'Dame las cámaras malas del último mantenimiento de un cliente',
  '¿Cómo se instala MorphoManager?',
];

function storageKey(userId, suffix) {
  return `dms_assistant_${suffix}_${userId || 'user'}`;
}

function initialMessage() {
  return {
    id: 'welcome',
    role: 'assistant',
    text: 'Puede preguntarme por boletas, mantenimientos, dispositivos, clientes y tutoriales. También entiendo abreviaciones como RN, Asamblea o BCR. Cuando una consulta sea ambigua, le pediré el dato que falta.',
    sources: [],
    options: [],
    suggestions: STARTER_QUESTIONS,
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
  return { route: cleanRoute };
}

function messageId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
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

        {message.sources?.length > 0 && (
          <div className="assistant-sources">
            <span className="assistant-sources__title"><Icon name="source" /> Fuentes consultadas</span>
            <div>
              {message.sources.map((source) => (
                <Link key={`${source.type}-${source.id}-${source.url}`} to={source.url}>
                  <Icon name={source.type === 'knowledge' ? 'menu_book' : source.type === 'ticket' ? 'description' : source.type === 'surveys' ? 'reviews' : 'engineering'} />
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

export default function AssistantPage() {
  const { user, sessionToken, hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const userId = user?.UsuarioID || user?.id || 'user';
  const messagesKey = storageKey(userId, 'messages');
  const contextKey = storageKey(userId, 'context');
  const conversationKey = storageKey(userId, 'conversation');
  const [messages, setMessages] = useState(() => {
    const stored = readJson(messagesKey, []);
    return Array.isArray(stored) && stored.length ? stored.slice(-40) : [initialMessage()];
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
  useEffect(() => { localStorage.setItem(messagesKey, JSON.stringify(messages.slice(-40))); }, [messages, messagesKey]);
  useEffect(() => { localStorage.setItem(contextKey, JSON.stringify(context)); }, [context, contextKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

  function historyForRequest(nextMessages) {
    return nextMessages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .slice(-8)
      .map((item) => ({ role: item.role, text: item.text }));
  }

  async function sendQuestion(rawQuestion, contextPatch = {}) {
    const question = String(rawQuestion || '').trim();
    if (!question || sending) return;
    const userMessage = { id: messageId(), role: 'user', text: question };
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
      const assistantMessage = {
        id: messageId(),
        role: 'assistant',
        text: response.answer || response.message || 'No se recibió una respuesta.',
        type: response.type || 'answer',
        sources: Array.isArray(response.sources) ? response.sources : [],
        options: Array.isArray(response.options) ? response.options : [],
        suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
        resumeQuestion: response.resumeQuestion || question,
      };
      setMessages((current) => [...current, assistantMessage]);
      if (response.context && typeof response.context === 'object') setContext(response.context);
    } catch (requestError) {
      const message = requestError?.message || 'No se pudo consultar el asistente.';
      setError(message);
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', text: message, sources: [], options: [], suggestions: [] }]);
    } finally {
      setSending(false);
    }
  }

  function chooseOption(message, option) {
    const patch = option.type === 'client'
      ? { lastClientId: option.value, lastClientName: option.label }
      : {};
    sendQuestion(message.resumeQuestion || `Consultar ${option.label}`, patch);
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
        <div>
          <span className="eyebrow">Consulta interna con IA</span>
          <h1>Asistente DMS</h1>
          <p>Consulta boletas, mantenimientos, dispositivos y la base de conocimientos usando lenguaje natural.</p>
        </div>
        <button className="button button--secondary button--compact" type="button" onClick={clearConversation} disabled={sending}>
          <Icon name="delete_sweep" /> Limpiar
        </button>
      </header>

      <section className="assistant-safety-note">
        <Icon name="verified_user" />
        <div>
          <strong>Respuestas basadas en datos internos</strong>
          <span>El asistente es de solo lectura y respeta los permisos del usuario. {isAdmin ? 'Como administrador, también puede consultar promedios de encuestas.' : 'Las métricas administrativas de encuestas permanecen restringidas.'}</span>
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

        <form className="assistant-composer" onSubmit={submit}>
          {error && <span className="assistant-composer__error"><Icon name="error" />{error}</span>}
          <div>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ej. ¿Qué pasó esta semana en RN?"
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
          <small>Puede usar nombres incompletos o abreviaciones. Si hay varias coincidencias, el asistente le pedirá seleccionar una.</small>
        </form>
      </section>
    </div>
  );
}
