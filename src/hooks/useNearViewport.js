import { useEffect, useRef, useState } from 'react';

export default function useNearViewport({ disabled = false, rootMargin = '700px 0px' } = {}) {
  const ref = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (disabled) {
      setNearViewport(false);
      return undefined;
    }

    const node = ref.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin });

    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled, rootMargin]);

  return { ref, nearViewport };
}
