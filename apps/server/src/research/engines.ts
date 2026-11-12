/** The web search engines a research can use: how to ask each one, and how to read its result page. */
export const ENGINE_IDS = ['google', 'yandex', 'bing', 'duckduckgo', 'brave'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_NAMES: Record<EngineId, string> = {
  google: 'Google',
  yandex: 'Yandex',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  brave: 'Brave Search',
};

export const isEngine = (value: string): value is EngineId => (ENGINE_IDS as readonly string[]).includes(value);

/** The address of one results page of an engine (`page` counts from 1). */
export function searchUrl(engine: EngineId, query: string, page = 1): string {
  const q = encodeURIComponent(query);
  const n = Math.max(1, Math.min(Math.floor(page), 5));
  switch (engine) {
    case 'google':
      return `https://www.google.com/search?q=${q}&num=10&pws=0${n > 1 ? `&start=${(n - 1) * 10}` : ''}`;
    case 'yandex':
      return `https://yandex.com/search/?text=${q}${n > 1 ? `&p=${n - 1}` : ''}`;
    case 'bing':
      return `https://www.bing.com/search?q=${q}${n > 1 ? `&first=${(n - 1) * 10 + 1}` : ''}`;
    case 'duckduckgo':
      return `https://html.duckduckgo.com/html/?q=${q}${n > 1 ? `&s=${(n - 1) * 30}` : ''}`;
    case 'brave':
      return `https://search.brave.com/search?q=${q}${n > 1 ? `&offset=${n - 1}` : ''}`;
  }
}

/** The page an engine's result link really leads to (engines wrap their links in a redirect). */
export function unwrapResultUrl(href: string): string {
  try {
    const u = new URL(href);
    if (/duckduckgo\./.test(u.hostname) && u.pathname.startsWith('/l/')) return u.searchParams.get('uddg') ?? href;
    if (/google\./.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') ?? u.searchParams.get('url') ?? href;
    if (/bing\./.test(u.hostname) && u.pathname.startsWith('/ck/')) {
      const v = u.searchParams.get('u');
      if (v?.startsWith('a1')) {
        const decoded = Buffer.from(v.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        if (/^https?:\/\//.test(decoded)) return decoded;
      }
    }
    return href;
  } catch {
    return href;
  }
}

export type SearchHit = { title: string; url: string; snippet: string };
export type SearchPage = { blocked: boolean; title: string; hits: SearchHit[] };

/** Runs in the results page: reads the hits of whichever engine it is, or says that the engine wants a robot check. */
export const READ_RESULTS_SCRIPT = `(() => {
  const host = location.hostname;
  const text = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();
  const body = document.body ? text(document.body).slice(0, 4000).toLowerCase() : '';
  const blocked = /sorry\\/index|showcaptcha|\\/captcha|challenge/.test(location.href) ||
    /unusual traffic|automated queries|not a robot|are you a robot|verify you are human|подтвердите, что запросы|введите символы|вы не робот|captcha/.test(body.slice(0, 1500));
  const out = [];
  const seen = new Set();
  const push = (a, title, snippet) => {
    const href = a && a.href;
    if (!href || !/^https?:/.test(href) || seen.has(href)) return;
    title = (title || '').trim();
    if (title.length < 3) return;
    seen.add(href);
    out.push({ title: title.slice(0, 200), href, snippet: (snippet || '').slice(0, 320) });
  };
  const pick = (root, sels) => { for (const s of sels) { const el = root.querySelector(s); if (el && text(el)) return text(el); } return ''; };
  if (/google\\./.test(host)) {
    document.querySelectorAll('#search a h3, #rso a h3').forEach((h) => {
      const a = h.closest('a'); if (!a) return;
      const box = a.closest('[data-hveid], .g, .MjjYud') || a.parentElement;
      push(a, text(h), box ? pick(box, ['[data-sncf]', '.VwiC3b', 'div[style*="line-clamp"]', 'span.st']) : '');
    });
  } else if (/yandex\\./.test(host)) {
    document.querySelectorAll('li.serp-item, .serp-item').forEach((li) => {
      const a = li.querySelector('a.OrganicTitle-Link, h2 a, a.Link'); if (!a) return;
      push(a, text(li.querySelector('.OrganicTitle-LinkText, h2')) || text(a), pick(li, ['.OrganicText', '.TextContainer', '.ExtendedText']));
    });
  } else if (/bing\\./.test(host)) {
    document.querySelectorAll('li.b_algo').forEach((li) => {
      const a = li.querySelector('h2 a'); if (!a) return;
      push(a, text(a), pick(li, ['.b_caption p', 'p']));
    });
  } else if (/duckduckgo\\./.test(host)) {
    document.querySelectorAll('.result, [data-testid="result"]').forEach((r) => {
      const a = r.querySelector('a.result__a, [data-testid="result-title-a"]'); if (!a) return;
      push(a, text(a), pick(r, ['.result__snippet', '[data-result="snippet"]']));
    });
  } else if (/brave\\./.test(host)) {
    document.querySelectorAll('#results .snippet, .snippet[data-type="web"]').forEach((r) => {
      const a = r.querySelector('a'); if (!a) return;
      push(a, pick(r, ['.title', '.snippet-title']) || text(a), pick(r, ['.snippet-description', '.content']));
    });
  }
  if (out.length === 0 && !blocked) {
    document.querySelectorAll('main a[href], #main a[href], body a[href]').forEach((a) => {
      try { if (new URL(a.href).hostname === host) return; } catch (e) { return; }
      const t = text(a);
      if (t.length >= 20) push(a, t, text(a.parentElement).slice(0, 240));
    });
  }
  return JSON.stringify({ blocked, title: document.title, results: out.slice(0, 15) });
})()`;

/** Parses what READ_RESULTS_SCRIPT returned. */
export function parseSearchPage(raw: string): SearchPage {
  const data = JSON.parse(raw) as { blocked: boolean; title: string; results: { title: string; href: string; snippet: string }[] };
  return {
    blocked: data.blocked,
    title: data.title,
    hits: data.results.map((r) => ({ title: r.title, url: unwrapResultUrl(r.href), snippet: r.snippet })),
  };
}

/** Runs in an article page: its readable text and the outgoing links worth following. */
export const READ_PAGE_SCRIPT = `(() => {
  const clean = (s) => s.replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  const root = document.querySelector('article, main, [role=main]') || document.body;
  const drop = root.cloneNode(true);
  drop.querySelectorAll('script,style,noscript,nav,footer,aside,form,iframe,svg').forEach((n) => n.remove());
  const text = clean(drop.innerText || drop.textContent || '');
  const links = [];
  const seen = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    try {
      const u = new URL(a.href);
      if (!/^https?:$/.test(u.protocol) || u.hostname === location.hostname || seen.has(u.href)) return;
      const t = (a.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t.length < 8) return;
      seen.add(u.href);
      links.push(t.slice(0, 90) + ' -> ' + u.href);
    } catch (e) {}
  });
  const meta = (n) => (document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]') || {}).content || '';
  const date = meta('article:published_time') || meta('date') || meta('og:updated_time') || (document.querySelector('time') || {}).dateTime || '';
  return JSON.stringify({ url: location.href, title: document.title, date, text, links: links.slice(0, 15) });
})()`;
