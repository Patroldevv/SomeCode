const KEY = 'somecode.token';

let pendingCode: string | null = null;

/**
 * The access token for this tab. The address the interface is opened with carries either a one-time launch code
 * (`#code=...`, see `exchangeLaunchCode`) or, for scripts and the demo, the token itself (`#token=...`). Either is
 * removed from the address bar at once, so it stays out of the history. A reload falls back to the stored token.
 */
export function loadToken(): string | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromHash = params.get('token');
  const code = params.get('code');
  if (fromHash || code) history.replaceState(null, '', location.pathname + location.search);
  if (fromHash) {
    try {
      sessionStorage.setItem(KEY, fromHash);
    } catch {
      // Storage may be unavailable; the token still works for this page load.
    }
    return fromHash;
  }
  if (code) pendingCode = code;
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The launch code found in the address by `loadToken`, if the token still has to be fetched with it. */
export function takeLaunchCode(): string | null {
  const code = pendingCode;
  pendingCode = null;
  return code;
}

/** Trades a one-time launch code for the access token and keeps it for this tab (null when the code is not valid). */
export async function exchangeLaunchCode(code: string): Promise<string | null> {
  try {
    const res = await fetch('/api/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (!res.ok) return null;
    const { token } = (await res.json()) as { token?: unknown };
    if (typeof token !== 'string' || token === '') return null;
    try {
      sessionStorage.setItem(KEY, token);
    } catch {
      // The token still works for this page load.
    }
    return token;
  } catch {
    return null;
  }
}
