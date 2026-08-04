import React, { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import {
  ensureAssistantHistoryRetention,
} from '../../services/assistantHistoryRetention';
import AssistantPageSecure from './AssistantPageSecure';

const MAX_TIMER_DELAY_MS = 2_147_000_000;

export default function AssistantPage() {
  const { user } = useAuth();
  const userId = user?.UsuarioID || user?.id || 'user';
  const [renderCycle, setRenderCycle] = useState(0);
  const [expiresAt, setExpiresAt] = useState(() => (
    ensureAssistantHistoryRetention({ userId }).expiresAt
  ));

  useEffect(() => {
    const result = ensureAssistantHistoryRetention({ userId });
    setExpiresAt(result.expiresAt);
    if (result.expired) setRenderCycle((current) => current + 1);
  }, [userId]);

  useEffect(() => {
    let timerId;

    const verifyExpiration = () => {
      const result = ensureAssistantHistoryRetention({ userId });
      setExpiresAt(result.expiresAt);
      if (result.expired) setRenderCycle((current) => current + 1);
    };

    const remaining = Math.max(250, expiresAt - Date.now());
    timerId = window.setTimeout(
      verifyExpiration,
      Math.min(remaining, MAX_TIMER_DELAY_MS),
    );

    const verifyWhenVisible = () => {
      if (document.visibilityState === 'visible') verifyExpiration();
    };

    window.addEventListener('focus', verifyExpiration);
    document.addEventListener('visibilitychange', verifyWhenVisible);

    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener('focus', verifyExpiration);
      document.removeEventListener('visibilitychange', verifyWhenVisible);
    };
  }, [expiresAt, userId]);

  return <AssistantPageSecure key={`${userId}-${renderCycle}`} />;
}
