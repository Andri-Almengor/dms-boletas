const FALLBACK_API_URL = 'https://script.google.com/macros/s/AKfycbzGZuFbXWJn3y4hbfSGRFeaJfWufu2xaDnoAb9dFZl4DklRXiuFU9-GSb-q2hnY7O6pmQ/exec';

export const API_URL = String(import.meta.env.VITE_API_URL || FALLBACK_API_URL).trim();

export async function apiRequest(route, payload = {}, sessionToken = '') {
  if (!API_URL) throw new Error('Falta configurar VITE_API_URL.');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ route, payload, sessionToken }),
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`El backend respondió con un formato inválido (${response.status}).`);
  }

  if (!response.ok || !result.ok) {
    const error = new Error(result?.error?.message || `Error de comunicación con el backend (${response.status}).`);
    error.code = result?.error?.code || 'API_ERROR';
    error.details = result?.error?.details || null;
    error.status = response.status;
    throw error;
  }

  return result.data;
}
