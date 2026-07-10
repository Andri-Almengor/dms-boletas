export const API_URL = 'https://script.google.com/macros/s/AKfycbzGZuFbXWJn3y4hbfSGRFeaJfWufu2xaDnoAb9dFZl4DklRXiuFU9-GSb-q2hnY7O6pmQ/exec';

export async function apiRequest(route, payload = {}, sessionToken = '') {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({ route, payload, sessionToken }),
  });

  const result = await response.json();

  if (!result.ok) {
    const error = new Error(result.error?.message || 'Error de comunicación con el backend.');
    error.code = result.error?.code || 'API_ERROR';
    error.details = result.error?.details || null;
    throw error;
  }

  return result.data;
}
