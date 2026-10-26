/**
 * Central browser diagnostics for the dApp.
 *
 * Every failure — handled or not — ends up in the DevTools console with a
 * consistent prefix, so "the site is broken" becomes "the site logged exactly
 * what broke and where". Three layers:
 *
 * 1. Global hooks: window.onerror, unhandledrejection, console.error override.
 *    Catches anything outside a try/catch (render crashes, forgotten promises).
 * 2. Diagnostic categories for the things that usually go wrong here:
 *    contract calls, wallet/network, transaction failures.
 * 3. A visible on-page error banner, because not everyone has DevTools open.
 *    (Exported so App.jsx can render it; kept in one place to avoid a
 *    dependency for what is a debugging aid.)
 *
 * Imported once in main.jsx; panels call reportTxError / reportContractError.
 */

const PREFIX = '[CarbonCredit]';

/** Severity levels, mirrored by the on-page banner styling. */
export const LEVELS = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

const state = {
  installed: false,
  listeners: new Set(),
  history: [],
};

/**
 * Notify the on-page banner (and anything else subscribed). Isolated in try/catch:
 * diagnostics must never be the thing that crashes the app.
 */
function notify(entry) {
  state.history.push(entry);
  if (state.history.length > 100) state.history.shift();
  try {
    state.listeners.forEach((fn) => fn(entry));
  } catch {
    /* never let diagnostics break the app */
  }
}

function log(level, message, detail) {
  const line = `${PREFIX} ${message}`;
  const emit = level === LEVELS.ERROR ? console.error : level === LEVELS.WARN ? console.warn : console.info;
  if (detail !== undefined) {
    emit(line, detail);
  } else {
    emit(line);
  }
  notify({ level, message: line, detail, at: new Date().toISOString() });
}

export const diagnostics = {
  /** Contract read reverted / call failed (not a user's transaction). */
  contractError(where, err) {
    log(LEVELS.ERROR, `Contract call failed in ${where}:`, err);
    const reason = err?.reason || err?.shortMessage || err?.data?.message;
    if (reason) log(LEVELS.INFO, `${where} revert reason: ${reason}`);
    return err;
  },

  /** A user's transaction failed: mined revert, rejected prompt, or RPC error. */
  txError(action, err) {
    log(LEVELS.ERROR, `Transaction failed: ${action}`, err);
    const reason =
      err?.revert?.args?.[0] ||
      err?.reason ||
      err?.shortMessage ||
      (err?.info?.error?.message ?? err?.data?.message);
    if (reason) log(LEVELS.INFO, `${action} — revert reason: ${reason}`);
    if (err?.code === 'ACTION_REJECTED') {
      log(LEVELS.WARN, `${action} — you rejected the transaction in your wallet`);
    }
    return err;
  },

  /** Wallet connect / network problems. */
  walletError(where, err) {
    log(LEVELS.ERROR, `Wallet issue (${where}):`, err);
    return err;
  },

  /** Expected misses (e.g. "challenge 7 doesn't exist"). Warn, not error. */
  expectedMiss(where, err) {
    log(LEVELS.WARN, `${where}: lookup missed (expected when nothing exists yet)`, err?.shortMessage || err?.message);
    return err;
  },

  /** Recoverable oddity that should still be visible. */
  warn(message, detail) {
    log(LEVELS.WARN, message, detail);
  },

  /** Lifecycle/progress notes (connected, network switched, tx confirmed). */
  info(message, detail) {
    log(LEVELS.INFO, message, detail);
  },

  /** Access the ring buffer of everything logged this session. */
  history() {
    return [...state.history];
  },
};

/**
 * Install global hooks. Idempotent, called once from main.jsx before render so
 * even module-evaluation failures are seen.
 */
export function installDiagnostics() {
  if (state.installed || typeof window === 'undefined') return diagnostics;
  state.installed = true;

  // 1. Uncaught synchronous errors and unhandled promise rejections.
  window.addEventListener('error', (event) => {
    log(LEVELS.ERROR, `Uncaught error at ${event.filename}:${event.lineno}:${event.colno}`, event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    log(LEVELS.ERROR, 'Unhandled promise rejection', event.reason);
  });

  // 2. console.error passthrough: if any code logs an error without going
  // through diagnostics, it still gets the prefix and reaches the banner.
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    try {
      const first = args[0];
      const alreadyOurs = typeof first === 'string' && first.startsWith(PREFIX);
      const isReactStack = typeof first === 'string' && first.startsWith('%c');
      if (!alreadyOurs && !isReactStack) {
        notify({ level: LEVELS.ERROR, message: `${PREFIX} ${String(first)}`, detail: args.slice(1), at: new Date().toISOString() });
      }
    } catch {
      /* never break console */
    }
    originalError(...args);
  };

  diagnostics.info('Diagnostics installed — errors surface here and in the on-page banner');
  return diagnostics;
}

/** Subscribe to new entries (used by the on-page banner). Returns an unsubscribe fn. */
export function onDiagnostic(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}
