import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../services/requestErrors';
import { mergePaginatedItems, paginationMeta } from '../utils/paginatedCollection';

function defaultNormalizeResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function defaultItemKey(item, index, source) {
  return item?.id || item?.ID || item?.RowID || `${source}-${index}`;
}

export default function usePaginatedResource({
  pageSize,
  fetchPage,
  getItemKey = defaultItemKey,
  normalizeResponse = defaultNormalizeResponse,
  enabled = true,
  autoLoad = true,
  resetKey = '',
  initialItems = [],
} = {}) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialItems.length);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(Boolean(enabled && autoLoad));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const requestSequence = useRef(0);
  const controllerRef = useRef(null);
  const fetchPageRef = useRef(fetchPage);
  const getItemKeyRef = useRef(getItemKey);
  const normalizeResponseRef = useRef(normalizeResponse);

  fetchPageRef.current = fetchPage;
  getItemKeyRef.current = getItemKey;
  normalizeResponseRef.current = normalizeResponse;

  const cancel = useCallback(() => {
    requestSequence.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const clear = useCallback(() => {
    cancel();
    setItems([]);
    setPage(1);
    setTotal(0);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
    setError('');
  }, [cancel]);

  const loadPage = useCallback(async ({ targetPage = 1, append = false } = {}) => {
    if (!enabled || typeof fetchPageRef.current !== 'function') return null;

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const data = await fetchPageRef.current({
        page: targetPage,
        pageSize,
        signal: controller.signal,
      });
      if (controller.signal.aborted || sequence !== requestSequence.current) return null;

      const incoming = normalizeResponseRef.current(data);
      setItems((current) => {
        const next = append
          ? mergePaginatedItems(current, incoming, getItemKeyRef.current)
          : incoming;
        const meta = paginationMeta(data, {
          loadedCount: next.length,
          incomingCount: incoming.length,
          pageSize,
        });
        setTotal(meta.total);
        setHasMore(meta.hasMore);
        return next;
      });
      setPage(targetPage);
      return data;
    } catch (loadError) {
      if (controller.signal.aborted || sequence !== requestSequence.current || isAbortError(loadError)) return null;
      setError(loadError?.message || 'No se pudo cargar la información.');
      if (!append) {
        setItems([]);
        setPage(1);
        setTotal(0);
        setHasMore(false);
      }
      return null;
    } finally {
      if (sequence === requestSequence.current) {
        if (controllerRef.current === controller) controllerRef.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [enabled, pageSize]);

  const loadFirst = useCallback(() => loadPage({ targetPage: 1, append: false }), [loadPage]);

  const loadMore = useCallback(() => {
    if (!enabled || loading || loadingMore || !hasMore) return Promise.resolve(null);
    return loadPage({ targetPage: page + 1, append: true });
  }, [enabled, hasMore, loadPage, loading, loadingMore, page]);

  const reload = useCallback(() => loadPage({ targetPage: 1, append: false }), [loadPage]);

  useEffect(() => {
    if (!enabled) {
      cancel();
      setLoading(false);
      setLoadingMore(false);
      return undefined;
    }
    if (autoLoad) loadFirst();
    return cancel;
  }, [autoLoad, cancel, enabled, loadFirst, resetKey]);

  return {
    items,
    setItems,
    page,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    setError,
    loadFirst,
    loadMore,
    reload,
    clear,
    cancel,
  };
}
