import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserMode } from '../browser/guard.ts';
import type { BrowserSession } from '../browser/session.ts';
import { guarded, text } from '../browser/tools.ts';
import { ENGINE_IDS, ENGINE_NAMES, READ_PAGE_SCRIPT, READ_RESULTS_SCRIPT, parseSearchPage, searchUrl, type EngineId } from './engines.ts';
import { blockedHost, dnsFacts, formatSiteReport, READ_SITE_SCRIPT, summarizeHeaders, type DnsFacts, type HeaderFacts, type PageFacts } from './site.ts';
import { DEPTHS, pickEngine, statusReport, type Depth, type Ledger } from './ledger.ts';

type Call = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<any>;

export type ResearchConfig = { plan: boolean; depth: Depth; engines: EngineId[] };

const run = async (body: () => Promise<string>) => {
  try {
    return text(await body());
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The tools of a deep research: a plan the user approves, progress on it, a ledger of sources, and (with the browser)
 * searching several engines and reading the pages. They keep the research honest: `research_status` says what is
 * still missing before a report may be written.
 */
export function registerResearchTools(
  server: McpServer,
  opts: { call: Call; sessionId: string | undefined; ledger: Ledger; config: ResearchConfig; browser: BrowserSession | null; browserMode: BrowserMode },
): void {
  const { call, sessionId, ledger, config, browser, browserMode } = opts;
  const need = DEPTHS[config.depth];

  server.registerTool(
    'research_plan',
    {
      title: 'Research plan',
      description:
        'Deep research, step one: shows the user your research plan as a card they can edit, start or cancel, and waits for their answer. Give 5-10 concrete steps (a question to answer or a place to look, each one line). Returns the steps to follow (the user may have changed them) or says they cancelled.',
      inputSchema: {
        title: z.string().min(3).max(140).describe('The research in one line, e.g. "Quickshell GitHub survey".'),
        steps: z.array(z.string().min(3).max(300)).min(3).max(12).describe('The steps, in order.'),
      },
    },
    ({ title, steps }) =>
      run(async () => {
        const started = (await call('POST', '/api/research/plan', { sessionId, title, steps, ask: config.plan })) as { requestId: string; steps?: string[] };
        let decided: { state: string; steps?: string[] } = started.steps ? { state: 'started', steps: started.steps } : { state: 'pending' };
        // The user may take a while: ask again until they answer (each request waits a little on the server).
        while (decided.state === 'pending') {
          await sleep(300);
          decided = await call('GET', `/api/research/plan/${started.requestId}?wait=20`);
        }
        if (decided.state !== 'started' || !decided.steps) return 'The user cancelled the research. Stop here, do not search; ask them briefly what they would like instead.';
        ledger.steps = decided.steps.map((content) => ({ content, status: 'pending' }));
        return [
          `The plan is approved${config.plan ? ' (the user may have edited it)' : ''}. Follow exactly these ${decided.steps.length} steps:`,
          ...decided.steps.map((s, i) => `${i + 1}. ${s}`),
          '',
          `Depth "${need.label}": per step use at least ${need.variants} different phrasings and read the best pages; overall use ${Math.min(need.engines, config.engines.length)}+ search engines and note ${need.sources}+ sources.`,
          'Mark each step with research_progress when you start and finish it.',
        ].join('\n');
      }),
  );

  server.registerTool(
    'research_progress',
    {
      title: 'Research progress',
      description: 'Marks a step of the approved plan as started (in_progress) or finished (completed); the user sees the plan tick off live. Steps count from 1.',
      inputSchema: { step: z.number().int().min(1).max(20), status: z.enum(['in_progress', 'completed']) },
    },
    ({ step, status }) =>
      run(async () => {
        await call('POST', '/api/research/progress', { sessionId, step, status });
        const item = ledger.steps[step - 1];
        if (item) item.status = status;
        const left = ledger.steps.filter((s) => s.status !== 'completed').length;
        return status === 'completed' ? `Step ${step} done. ${left === 0 ? 'All steps done: check research_status, then write the report.' : `${left} left.`}` : `Step ${step} started.`;
      }),
  );

  server.registerTool(
    'research_note',
    {
      title: 'Note a source',
      description:
        'Writes a source you actually read into the research ledger: what it says that matters, and how far you trust it (primary/official/recent = high). The report cites only noted sources. Noting the same address again updates it.',
      inputSchema: {
        url: z.string().url(),
        title: z.string().min(1).max(200),
        finding: z.string().min(5).max(1200).describe('What this source established, in your words (facts, numbers, dates).'),
        confidence: z.enum(['high', 'medium', 'low']),
        step: z.number().int().min(1).max(20).optional().describe('The plan step it belongs to.'),
      },
    },
    ({ url, title, finding, confidence, step }) =>
      run(async () => {
        ledger.sources.set(url, { url, title, finding, confidence, ...(step !== undefined ? { step } : {}) });
        return `Noted [${ledger.sources.size}] ${title}.`;
      }),
  );

  server.registerTool(
    'research_status',
    {
      title: 'Research status',
      description: 'How far the research is against what its depth asks for (engines used, searches, pages read, sources, plan steps) and what is still missing. Call it before you write the report; keep researching while it says "Not yet enough".',
      inputSchema: {},
    },
    () => run(async () => `${statusReport(ledger, config.depth, config.engines)}\n\nNoted sources:\n${[...ledger.sources.values()].map((s, i) => `[${i + 1}] ${s.title} (${s.confidence}) ${s.url}`).join('\n') || '(none)'}`),
  );

  if (!browser || browserMode !== 'any') return;

  server.registerTool(
    'web_search',
    {
      title: 'Web search',
      description: `Searches the web in a hidden browser with a chosen engine (${config.engines.map((e) => e).join(', ')}) and returns titles, addresses and snippets. Vary the wording on every call: synonyms, another language, quoted phrases, site: or filetype: operators, a year. Leave engine out to rotate through the engines. If an engine shows a robot check, use another one.`,
      inputSchema: {
        query: z.string().min(2).max(300),
        engine: z.enum(ENGINE_IDS).optional().describe('Default: the engine used least so far.'),
        page: z.number().int().min(1).max(5).optional().describe('Results page, from 1.'),
        step: z.number().int().min(1).max(20).optional().describe('The plan step this search serves (counted for coverage).'),
      },
    },
    ({ query, engine, page, step }) =>
      guarded(async () => {
        const chosen: EngineId = engine && config.engines.includes(engine) ? engine : pickEngine(ledger, config.engines);
        await browser.open(searchUrl(chosen, query, page ?? 1));
        // Result lists render a moment after the load event on some engines.
        await browser.waitFor({ selector: 'a h3, li.b_algo, .serp-item, .result, #results', ms: 4000 }).catch(() => false);
        const result = parseSearchPage(await browser.evaluate(READ_RESULTS_SCRIPT, 40_000));
        ledger.searches.push({ engine: chosen, query, hits: result.hits.length, blocked: result.blocked, ...(step !== undefined ? { step } : {}) });
        if (result.blocked) {
          const others = config.engines.filter((e) => e !== chosen).map((e) => ENGINE_NAMES[e]);
          return text(`${ENGINE_NAMES[chosen]} wants a robot check and returned nothing. Do not retry it for now; search the same thing with ${others.join(', ') || 'another way'}.`);
        }
        if (result.hits.length === 0) return text(`${ENGINE_NAMES[chosen]} returned no results for "${query}". Rephrase it (fewer words, another language) or use another engine.`);
        const rows = result.hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`);
        return text([`${ENGINE_NAMES[chosen]} · "${query}"${page && page > 1 ? ` · page ${page}` : ''} · ${result.hits.length} results`, ...rows].join('\n'));
      }),
  );

  server.registerTool(
    'web_read',
    {
      title: 'Read a web page',
      description: 'Opens a page and returns its readable text (main content, without menus), its date when it states one, and the outgoing links worth following (references, primary sources). Read the page itself: do not rely on search snippets.',
      inputSchema: { url: z.string().url(), maxChars: z.number().int().min(1000).max(30_000).optional().describe('Default 12000.') },
    },
    ({ url, maxChars }) =>
      guarded(async () => {
        await browser.open(url);
        await browser.waitFor({ ms: 600 }).catch(() => false);
        const page = JSON.parse(await browser.evaluate(READ_PAGE_SCRIPT, 200_000)) as { url: string; title: string; date: string; text: string; links: string[] };
        ledger.pages.add(page.url);
        const limit = maxChars ?? 12_000;
        const body = page.text.length > limit ? `${page.text.slice(0, limit)}\n… (cut: ${page.text.length - limit} more characters; scroll with browser_scroll/browser_snapshot or read the next section)` : page.text;
        return text(
          [`URL: ${page.url}`, `Title: ${page.title || '(none)'}`, page.date ? `Date: ${page.date}` : 'Date: not stated on the page', '', body || '(no readable text: try browser_snapshot)', ...(page.links.length > 0 ? ['', 'Links to follow:', ...page.links] : [])].join('\n'),
        );
      }),
  );

  server.registerTool(
    'site_inspect',
    {
      title: 'Inspect a public website',
      description:
        'Looks at how a public website is built, from the outside and with public information only: response headers (server, CDN, caching, security headers, cookie flags), DNS records, robots.txt/sitemap/security.txt, and the rendered page (frameworks and libraries it shows, scripts, stylesheets, third-party hosts, data requests). Use it for "how is this site built / what is its infrastructure". It never probes ports, never tries inputs and refuses local or private addresses.',
      inputSchema: { url: z.string().url().describe('The site address, e.g. https://example.com.') },
    },
    ({ url }) =>
      guarded(async () => {
        const target = new URL(url);
        const blocked = await blockedHost(target.hostname);
        if (blocked) return text(`Refused: ${blocked}.`);
        const origin = target.origin;
        // Redirects are followed by hand, so that a public site cannot send the request on into a private network.
        const get = async (path: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> => {
          let next = new URL(path, origin);
          for (let hop = 0; hop < 5; hop += 1) {
            if (hop > 0 && (await blockedHost(next.hostname))) throw new Error('redirected into a private network');
            const res = await fetch(next, { method, redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; SomeCodeResearch/1.0)' } });
            const location = res.headers.get('location');
            if (res.status < 300 || res.status >= 400 || !location) return res;
            await res.body?.cancel();
            next = new URL(location, next);
          }
          throw new Error('too many redirects');
        };
        let http: HeaderFacts | null = null;
        let httpError: string | undefined;
        try {
          const res = await get(target.pathname + target.search);
          http = summarizeHeaders(res.status, res.url, res.headers);
          await res.body?.cancel();
        } catch (error) {
          httpError = error instanceof Error ? error.message : String(error);
        }
        const dns: DnsFacts | null = await dnsFacts(target.hostname).catch(() => null);
        const robots = await get('/robots.txt').then(async (r) => (r.ok && /text|plain/i.test(r.headers.get('content-type') ?? 'text/plain') ? (await r.text()).slice(0, 1500) : null)).catch(() => null);
        const sitemap = await get('/sitemap.xml', 'HEAD').then((r) => r.ok).catch(() => null);
        const security = await get('/.well-known/security.txt', 'HEAD').then((r) => r.ok).catch(() => null);
        let page: PageFacts | null = null;
        let pageError: string | undefined;
        try {
          await browser.open(url);
          await browser.waitFor({ ms: 1500 }).catch(() => false);
          page = JSON.parse(await browser.evaluate(READ_SITE_SCRIPT, 60_000)) as PageFacts;
          ledger.pages.add(page.url);
        } catch (error) {
          pageError = error instanceof Error ? error.message : String(error);
        }
        return text(formatSiteReport({ origin, http, ...(httpError ? { httpError } : {}), dns, page, ...(pageError ? { pageError } : {}), robots, sitemap, security }));
      }),
  );
}

/** The research settings SomeCode hands to the MCP server as JSON (anything unreadable falls back to the defaults). */
export function parseResearchConfig(raw: string | undefined): ResearchConfig {
  const fallback: ResearchConfig = { plan: true, depth: 'deep', engines: ['google', 'yandex', 'bing', 'duckduckgo'] };
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw) as { plan?: unknown; depth?: unknown; engines?: unknown };
    const engines = Array.isArray(data.engines) ? data.engines.filter((e): e is EngineId => typeof e === 'string' && (ENGINE_IDS as readonly string[]).includes(e)) : [];
    return {
      plan: data.plan !== false,
      depth: data.depth === 'standard' || data.depth === 'exhaustive' ? data.depth : 'deep',
      engines: engines.length > 0 ? engines : fallback.engines,
    };
  } catch {
    return fallback;
  }
}
