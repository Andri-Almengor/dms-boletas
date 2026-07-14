import React, { useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { requestAvailable } from '../../services/moduleApi';
import '../../styles/technical-writing.css';
import Icon from '../common/Icon';

const FIELD_KEYS = ['razonVisita', 'pruebasRealizadas', 'resultado', 'recomendaciones'];
const ROUTES = ['ai.technicalRewrite', 'gemini.technicalRewrite', 'boletas.ai.rewrite'];

function snapshot(form) {
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, String(form[key] || '')]));
}

export default function TechnicalWritingAssistant({ form, setForm, disabled = false }) {
  const { sessionToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [previous, setPrevious] = useState(null);
  const hasText = useMemo(() => FIELD_KEYS.some((key) => String(form[key] || '').trim()), [form]);

  async function improve() {
    if (!hasText) {
      setError('Escriba primero al menos uno de los campos del reporte técnico.');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    const before = snapshot(form);
    try {
      const response = await requestAvailable(ROUTES, {
        fields: before,
        ...before,
        titulo: form.titulo,
        cliente: form.cliente,
        ubicacion: [form.ubicacion, form.ubicacionEquipo].filter(Boolean).join(' · '),
        categoria: form.categoria,
        tipoFalla: form.tipoFalla,
        tipoDispositivo: form.tipoDispositivo,
        nombreDispositivo: form.nombreDispositivo,
        fabricante: form.fabricante,
        modelo: form.modelo,
        serie: form.serie,
      }, sessionToken);
      const fields = response?.fields || response;
      setPrevious(before);
      setForm((current) => ({
        ...current,
        ...Object.fromEntries(FIELD_KEYS.map((key) => [key, fields?.[key] ?? current[key]])),
      }));
      setMessage('Gemini mejoró la redacción. Revise el contenido antes de guardar o finalizar.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo mejorar la redacción con Gemini.');
    } finally {
      setLoading(false);
    }
  }

  function undo() {
    if (!previous) return;
    setForm((current) => ({ ...current, ...previous }));
    setPrevious(null);
    setMessage('Se restauró la redacción anterior.');
    setError('');
  }

  return (
    <div className="info-box technical-writing-assistant">
      <Icon name="auto_awesome" />
      <div>
        <strong>Redacción técnica con Gemini</strong>
        <p>Corrige ortografía y convierte lo escrito en un reporte más técnico sin agregar hechos que el técnico no haya indicado.</p>
        {error && <small className="field-error">{error}</small>}
        {message && <small>{message}</small>}
        <div className="inline-actions">
          <button className="button button--secondary button--compact" type="button" onClick={improve} disabled={disabled || loading || !hasText}>
            <Icon name={loading ? 'progress_activity' : 'auto_awesome'} />
            {loading ? 'Mejorando redacción...' : 'Mejorar los cuatro campos'}
          </button>
          {previous && (
            <button className="button button--secondary button--compact" type="button" onClick={undo} disabled={disabled || loading}>
              <Icon name="undo" /> Deshacer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
