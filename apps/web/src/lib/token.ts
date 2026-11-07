const KEY = 'somecode.token';

/**
 * Reads `#token=...` from the URL hash, keeps it in sessionStorage and clears the hash so the
 * token does not stay in the address bar or history. Falls back to the stored token on reload.
 */
export function loadToken(): string | null {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
  if (fromHash) {
    try {
      sessionStorage.setItem(KEY, fromHash);
    } catch {
      // Storage may be unavailable; the token still works for this page load.
    }
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
