export type BrowserMode = 'off' | 'local' | 'any';

export const parseBrowserMode = (value: string | undefined): BrowserMode => (value === 'any' || value === 'local' ? value : 'off');

const LOCAL_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

/** Whether the browser may open this address: only http(s) (and, in "local" mode, only this computer). */
export function urlAllowed(raw: string, mode: BrowserMode): { ok: true; url: string } | { ok: false; reason: string } {
  if (mode === 'off') return { ok: false, reason: 'the browser tools are switched off in the settings' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'that is not a full address (it needs http:// or https://)' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'only http and https addresses can be opened' };
  if (mode === 'local' && !LOCAL_HOSTS.test(url.hostname) && !url.hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'the browser may only open addresses on this computer (localhost); change this in the settings' };
  }
  return { ok: true, url: url.toString() };
}

/** Requests the page itself makes (images, scripts, ...): in "local" mode only this computer and inline data. */
export function requestAllowed(raw: string, mode: BrowserMode): boolean {
  if (mode === 'any') return true;
  if (mode === 'off') return false;
  try {
    const url = new URL(raw);
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return true;
    return LOCAL_HOSTS.test(url.hostname) || url.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}
