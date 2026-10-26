import React, { useEffect, useState } from 'react';
import { onDiagnostic, LEVELS } from '../utils/diagnostics';

/**
 * On-page mirror of the console diagnostics: every error that reaches the
 * console also shows here, so failures are visible without opening DevTools.
 * Errors stay until dismissed; warnings auto-clear after a few seconds.
 */
function ErrorBanner() {
  const [errors, setErrors] = useState([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const unsubscribe = onDiagnostic((entry) => {
      if (entry.level !== LEVELS.ERROR) return;
      setErrors((prev) => [...prev.slice(-4), entry]);
    });
    return unsubscribe;
  }, []);

  if (!open || errors.length === 0) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        maxWidth: '480px',
        maxHeight: '40vh',
        overflowY: 'auto',
        background: '#b71c1c',
        color: '#fff',
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        zIndex: 9999,
        fontSize: '0.85rem',
        fontFamily: 'monospace',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <strong>
          {errors.length} error{errors.length > 1 ? 's' : ''} — details in the console ([CarbonCredit] prefix)
        </strong>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setOpen(false)}
            style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', borderRadius: '4px', cursor: 'pointer', padding: '0.1rem 0.5rem' }}
            title="Hide (errors keep accumulating in the console)"
          >
            —
          </button>
          <button
            onClick={() => { setErrors([]); setOpen(false); }}
            style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', borderRadius: '4px', cursor: 'pointer', padding: '0.1rem 0.5rem' }}
            title="Dismiss all shown errors"
          >
            ✕
          </button>
        </div>
      </div>
      <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
        {errors.map((e, i) => (
          <li key={i} style={{ marginBottom: '0.35rem', wordBreak: 'break-word' }}>
            {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ErrorBanner;
