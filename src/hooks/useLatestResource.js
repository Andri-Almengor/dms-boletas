import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../services/requestErrors';

// Owns only the current view request. Caching/deduplication remain in api.js.
export default function useLatestResource(fetchResource, errorMessage) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controllerRef = useRef(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const load = useCallback(async () => {
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = () => controllerRef.current === controller && !controller.signal.aborted;
    setLoading(true);
    setError('');
    try {
      const result = await fetchResource(controller.signal);
      if (current()) setData(result);
    } catch (requestError) {
      if (current() && !isAbortError(requestError)) setError(requestError.message || errorMessage);
    } finally {
      if (current()) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, [cancel, fetchResource, errorMessage]);

  useEffect(() => {
    load();
    return cancel;
  }, [load, cancel]);

  return { data, loading, error, load };
}
