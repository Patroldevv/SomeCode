// Link allow-list for UNTRUSTED agent markdown. Strict on purpose: anything not plainly `http(s)://…`,
// `mailto:…` or `#fragment` is refused, so obfuscated schemes (`java\tscript:`, `%6Aavascript:`, Cyrillic
// look-alikes, leading spaces/NUL/zero-width characters) and relative URLs never become an href.

/** ASCII control characters (C0, DEL) and C1 controls; URL parsers silently drop some of them (tab, LF, CR). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** Scheme as RFC 3986 spells it (ASCII only), followed by `:`. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WEB = /^https?:\/\/[^/\\]/i;

/**
 * Returns `url` unchanged when it is safe to use as a link target, otherwise `null`.
 * Allowed: `http://…`, `https://…` (absolute, with a host), `mailto:…`, `#fragment`.
 */
export function safeHref(url: string): string | null {
  if (url.length === 0 || CONTROL.test(url) || url.trim() !== url) return null;
  if (url.startsWith('#')) return url;

  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined) return null; // relative (`/x`, `foo`, `//host`) or not a scheme we can read
  if ((scheme === 'http' || scheme === 'https') && !WEB.test(url)) return null; // `http:foo`, `https:/x`
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') return null;

  // Second opinion from the URL parser: the protocol it reads must be the one we allowed.
  let protocol: string;
  try {
    protocol = new URL(url, 'http://placeholder.invalid').protocol;
  } catch {
    return null;
  }
  return protocol === `${scheme}:` ? url : null;
}
