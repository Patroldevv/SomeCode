import { isIP } from 'node:net';
import { resolve4, resolve6, resolveCname, resolveMx, resolveNs, resolveTxt } from 'node:dns/promises';

/** Whether an address is on this computer or a private network (a research of a public site never needs those). */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80') || a.startsWith('::ffff:127.') || a.startsWith('::ffff:10.') || a.startsWith('::ffff:192.168.');
  }
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = p as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Why a host may not be looked into (this computer or a private network), or null. */
export async function blockedHost(hostname: string): Promise<string | null> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'that is a local address: use browser_open for an app on this computer';
  if (isIP(host)) return isPrivateAddress(host) ? 'that is a private network address' : null;
  const found = (await Promise.all([resolve4(host).catch(() => [] as string[]), resolve6(host).catch(() => [] as string[])])).flat();
  return found.some(isPrivateAddress) ? 'that name points into a private network' : null;
}

const INTERESTING = ['server', 'x-powered-by', 'via', 'x-generator', 'x-aspnet-version', 'x-drupal-cache', 'x-shopify-stage', 'x-vercel-id', 'x-nf-request-id', 'x-amz-cf-id', 'x-amz-request-id', 'cf-ray', 'x-served-by', 'x-cache', 'age', 'cache-control', 'content-type', 'content-encoding', 'alt-svc', 'link', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'access-control-allow-origin', 'report-to', 'nel'];

export type HeaderFacts = { status: number; url: string; headers: [string, string][]; cookies: string[]; missingSecurity: string[] };

/** The response headers worth a researcher's attention, the cookies by name and flags (never their values), and the security headers that are missing. */
export function summarizeHeaders(status: number, url: string, headers: Headers): HeaderFacts {
  const rows: [string, string][] = [];
  for (const name of INTERESTING) {
    const value = headers.get(name);
    if (value) rows.push([name, value.length > 220 ? `${value.slice(0, 217)}…` : value]);
  }
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const cookies = raw.map((c) => {
    const [pair, ...flags] = c.split(';');
    return `${pair!.split('=')[0]!.trim()} (${flags.map((f) => f.trim().split('=')[0]!.toLowerCase()).filter((f) => ['secure', 'httponly', 'samesite'].includes(f)).join(', ') || 'no flags'})`;
  });
  const missingSecurity = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy'].filter((h) => !headers.has(h));
  return { status, url, headers: rows, cookies, missingSecurity };
}

export type DnsFacts = Record<'A' | 'AAAA' | 'CNAME' | 'NS' | 'MX' | 'TXT', string[]>;

/** The public DNS records of a name (what anyone can look up). */
export async function dnsFacts(hostname: string): Promise<DnsFacts> {
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [A, AAAA, CNAME, NS, MX, TXT] = await Promise.all([
    safe(resolve4(hostname), [] as string[]),
    safe(resolve6(hostname), [] as string[]),
    safe(resolveCname(hostname), [] as string[]),
    safe(resolveNs(hostname.split('.').slice(-2).join('.')), [] as string[]),
    safe(resolveMx(hostname), [] as { exchange: string; priority: number }[]),
    safe(resolveTxt(hostname), [] as string[][]),
  ]);
  return { A, AAAA, CNAME, NS, MX: MX.map((m) => `${m.priority} ${m.exchange}`), TXT: TXT.slice(0, 8).map((t) => t.join('').slice(0, 120)) };
}

/** Runs in the page: what it is built with, as seen from the outside. */
export const READ_SITE_SCRIPT = `(() => {
  const host = location.hostname;
  const hosts = {};
  const apis = [];
  for (const e of performance.getEntriesByType('resource')) {
    try {
      const u = new URL(e.name);
      hosts[u.hostname] = (hosts[u.hostname] || 0) + 1;
      if ((e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') && apis.length < 25) apis.push(u.hostname + u.pathname);
    } catch (e2) {}
  }
  const meta = (n) => (document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]') || {}).content || '';
  const w = window;
  const tech = [];
  const add = (cond, name) => { try { if (cond) tech.push(name); } catch (e3) {} };
  add(w.__NEXT_DATA__ || document.getElementById('__next'), 'Next.js');
  add(w.__NUXT__ || document.getElementById('__nuxt'), 'Nuxt');
  add(w.___gatsby || document.getElementById('___gatsby'), 'Gatsby');
  add(document.querySelector('astro-island, [data-astro-cid]'), 'Astro');
  add(w.__remixContext, 'Remix');
  add(document.querySelector('[ng-version]') || w.ng, 'Angular' + ((document.querySelector('[ng-version]') || {}).getAttribute ? ' ' + document.querySelector('[ng-version]').getAttribute('ng-version') : ''));
  add(w.React || document.querySelector('[data-reactroot]') || [...document.querySelectorAll('div')].some((d) => Object.keys(d).some((k) => k.startsWith('__reactContainer'))), 'React');
  add(w.Vue || document.querySelector('[data-v-app]') || [...document.querySelectorAll('div')].some((d) => d.__vue_app__), 'Vue');
  add(document.querySelector('[class*="svelte-"]'), 'Svelte');
  add(w.jQuery, 'jQuery ' + (w.jQuery && w.jQuery.fn ? w.jQuery.fn.jquery : ''));
  add(w.htmx, 'htmx');
  add(w.Shopify, 'Shopify');
  add(document.querySelector('link[href*="wp-content"], script[src*="wp-content"]'), 'WordPress');
  add(document.querySelector('script[src*="webflow"], html[data-wf-site]'), 'Webflow');
  add(w.Alpine, 'Alpine.js');
  add(w.dataLayer, 'Google Tag Manager / dataLayer');
  add(w.ga || w.gtag, 'Google Analytics');
  add(document.querySelector('script[src*="cloudflareinsights"]'), 'Cloudflare Web Analytics');
  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src).slice(0, 30);
  const styles = [...document.querySelectorAll('link[rel=stylesheet]')].map((s) => s.href).slice(0, 15);
  return JSON.stringify({
    url: location.href, title: document.title, generator: meta('generator'), description: meta('description').slice(0, 200),
    lang: document.documentElement.lang, charset: document.characterSet, manifest: (document.querySelector('link[rel=manifest]') || {}).href || '',
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || '', tech,
    thirdParty: Object.entries(hosts).filter(([h]) => h !== host).sort((a, b) => b[1] - a[1]).slice(0, 20),
    apis, scripts, styles, cookieNames: document.cookie ? document.cookie.split(';').map((c) => c.split('=')[0].trim()) : [],
    forms: document.forms.length, links: document.links.length, images: document.images.length,
    serviceWorker: 'serviceWorker' in navigator,
  });
})()`;

export type PageFacts = {
  url: string; title: string; generator: string; description: string; lang: string; charset: string; manifest: string; canonical: string;
  tech: string[]; thirdParty: [string, number][]; apis: string[]; scripts: string[]; styles: string[]; cookieNames: string[]; forms: number; links: number; images: number; serviceWorker: boolean;
};

const list = (items: readonly string[], empty = '(none)'): string => (items.length > 0 ? items.join(', ') : empty);

/** One readable report from everything that was gathered about a public site. */
export function formatSiteReport(input: { origin: string; http: HeaderFacts | null; httpError?: string; dns: DnsFacts | null; page: PageFacts | null; pageError?: string; robots: string | null; sitemap: boolean | null; security: boolean | null }): string {
  const out: string[] = [`SITE INSPECTION of ${input.origin} (public information only: nothing was changed or probed)`];
  if (input.http) {
    out.push('', `HTTP: ${input.http.status} ${input.http.url}`, ...input.http.headers.map(([k, v]) => `  ${k}: ${v}`));
    if (input.http.cookies.length > 0) out.push(`  cookies set: ${input.http.cookies.join('; ')}`);
    out.push(`  missing security headers: ${list(input.http.missingSecurity, 'none of the common ones')}`);
  } else if (input.httpError) out.push('', `HTTP: could not fetch (${input.httpError})`);
  if (input.dns) {
    out.push('', 'DNS:', ...(Object.entries(input.dns) as [string, string[]][]).filter(([, v]) => v.length > 0).map(([k, v]) => `  ${k}: ${v.join(' | ')}`));
  }
  if (input.page) {
    const p = input.page;
    out.push('', `PAGE: "${p.title}" (${p.lang || 'no lang'}, ${p.charset})`, `  detected: ${list(p.tech)}${p.generator ? `; generator meta: ${p.generator}` : ''}`);
    if (p.manifest) out.push(`  web app manifest: ${p.manifest}`);
    out.push(`  service worker supported: ${p.serviceWorker}; forms: ${p.forms}; links: ${p.links}; images: ${p.images}`);
    out.push(`  third-party hosts loaded: ${p.thirdParty.map(([h, n]) => `${h} (${n})`).join(', ') || '(none)'}`);
    if (p.apis.length > 0) out.push(`  data requests seen: ${p.apis.join(', ')}`);
    if (p.scripts.length > 0) out.push('  scripts:', ...p.scripts.map((s) => `    ${s}`));
    if (p.styles.length > 0) out.push('  stylesheets:', ...p.styles.map((s) => `    ${s}`));
    if (p.cookieNames.length > 0) out.push(`  cookies visible to scripts: ${p.cookieNames.join(', ')}`);
  } else if (input.pageError) out.push('', `PAGE: could not be rendered (${input.pageError})`);
  out.push('', `robots.txt: ${input.robots === null ? 'not found' : `\n${input.robots}`}`, `sitemap.xml: ${input.sitemap === null ? 'unknown' : input.sitemap ? 'present' : 'not found'}`, `security.txt: ${input.security === null ? 'unknown' : input.security ? 'present' : 'not found'}`);
  out.push('', 'Next: read the scripts/bundles you care about with web_read, look at the site\'s public repositories and docs, and cite what you found.');
  return out.join('\n');
}
