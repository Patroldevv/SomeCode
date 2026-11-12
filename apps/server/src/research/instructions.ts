import { DEPTHS, type Depth } from './ledger.ts';
import { ENGINE_NAMES, type EngineId } from './engines.ts';

/**
 * What an agent is told, with every message, while a chat is in deep research mode: work like a researcher, not like
 * a chat bot. Written for any agent; it names the tools SomeCode offers only when they are on.
 */
export function researchInstructions(opts: {
  browser: 'off' | 'local' | 'any';
  scout: boolean;
  memory: boolean;
  /** SomeCode's research tools (plan card, ledger, web search) are on. */
  tools?: boolean;
  /** The user approves the plan before it starts. */
  plan?: boolean;
  depth?: Depth;
  engines?: readonly EngineId[];
}): string {
  const depth = opts.depth ?? 'deep';
  const need = DEPTHS[depth];
  const engines = (opts.engines ?? ['google', 'yandex', 'bing', 'duckduckgo']).map((e) => ENGINE_NAMES[e]);
  const searchTool = opts.tools && opts.browser === 'any';
  const header = `[DEEP RESEARCH MODE (${need.label}): the user wants a thorough, exhaustively sourced answer, not a quick one. Work like a research team, and do not stop at the first plausible answer.]`;

  if (!opts.tools) {
    const how = [
      opts.browser === 'any' ? '`browser_open`/`browser_snapshot` (any web address)' : null,
      'your own web search and fetch tools',
      opts.scout ? 'the `scout` tool for reading many local files at once' : null,
      'sub-agents to look into separate questions in parallel',
    ].filter(Boolean);
    return [
      header,
      '1. Plan first. Restate the question in one line and split it into 5-8 concrete sub-questions. Keep that list as your plan (your plan/todo tool) and tick it off as you go.',
      `2. Gather widely. For each sub-question look at several independent sources using ${how.join(', ')}. Search with different wordings (synonyms, another language, quoted phrases, site: filters). Prefer primary sources over summaries and blogs. Read the pages, do not rely on search snippets.`,
      '3. Cross-check. Note where sources agree and conflict, and say which you trust and why. Pay attention to dates. Do not state anything you did not find.',
      '4. Report in the language the user writes in: a short answer first, the findings under headings with their evidence, then "What is uncertain or missing". Cite claims as [1], [2], ... and finish with a numbered "Sources" list (title and address). Never invent a source or a quote.',
    ].join('\n');
  }

  return [
    header,
    `1. PLAN. Call \`research_plan\` first with a title and 6-10 concrete steps (what to find out or where to look: official docs and repositories, independent reviews, comparisons, recent changes, counter-arguments, numbers to verify).${opts.plan ? ' The user sees it as a card and may edit, start or cancel it: wait for the answer and follow the approved steps exactly. If they cancel, stop and ask what they want instead.' : ' It is shown to the user and starts at once.'} Do not search before the plan exists.`,
    '2. WORK THE PLAN. Call `research_progress` (in_progress, then completed) for every step so the user can follow along.',
    searchTool
      ? `3. SEARCH WIDELY with \`web_search\` (engines: ${engines.join(', ')}). For every step use at least ${need.variants} different phrasings: synonyms, the other language (the user's language and English; Russian or local-language terms on Yandex when the topic is regional), exact phrases in quotes, \`site:\`/\`filetype:\` operators, a year, "vs"/"alternatives"/"problems"/"benchmark" angles. Start with Google; when it is exhausted or shows a robot check, continue with ${engines.filter((e) => e !== 'Google').join(', ') || 'the next engine'}, then look at page 2 of promising queries. Some engines show a robot check to the hidden browser: that is expected, do not try to get past it, just carry on with the others (and with your own web search tool if you have one). Never accept the first page of a single engine as complete.`
      : '3. SEARCH WIDELY with your own web search and fetch tools. For every step use at least ' + `${need.variants} different phrasings (synonyms, the other language, quoted phrases, site: filters, a year) and several search engines when you can choose (${engines.join(', ')}). Never accept one query as complete.`,
    searchTool
      ? '4. INSPECT THE SITES. Open the best results with `web_read` (the page text, its date and the links worth following) and read them: do not rely on snippets. Follow references to primary sources (official documentation, repositories, papers, standards, original data), check who wrote it and when, and open at least 3 pages per step. For a code repository read its README, recent commits/releases and issues. Use `browser_snapshot`/`browser_screenshot` for pages that need a closer look.'
      : '4. INSPECT THE SITES. Open and read the best results (not only snippets), follow references to primary sources, check who wrote them and when.',
    searchTool
      ? '4b. CODE AND INFRASTRUCTURE. When the question is about how a website, product or project is built (its technology, hosting, architecture, dependencies), look at it from the outside with `site_inspect` (headers, DNS, frameworks, scripts, third-party hosts, robots/sitemap) on the site and on its related hosts (docs, api, status, cdn), then read what the owners published: public repositories (README, package files, workflows, recent commits and issues, via web_read on the GitHub pages or raw files), engineering blog posts, documentation, job listings, status pages. Keep observed facts apart from inferences and label each ("seen in the headers" / "inferred from the bundle"). This is passive research of public information only: never probe ports, try inputs, bypass logins or test for vulnerabilities.'
      : null,
    `5. KEEP A LEDGER. After each page you used, call \`research_note\` (address, title, what it established, how far you trust it). The report cites only noted sources.`,
    `6. CROSS-CHECK. Compare sources: where they agree, where they conflict, which is more recent or more authoritative. Verify numbers (stars, versions, dates, prices) on a second source. Say what may be out of date. State nothing you did not find.`,
    `7. CHECK COVERAGE. Before you write, call \`research_status\`. This research needs at least ${Math.min(need.engines, engines.length)} search engines, ${need.sources} noted sources and every plan step completed. While it says "Not yet enough", keep researching. If something truly cannot be found, say exactly what you tried.`,
    '8. REPORT in the language the user writes in: a short answer first (3-5 sentences); then the findings under clear headings, with comparison tables where options are compared; then recommendations; then "What is uncertain or missing". Cite every non-obvious claim as [1], [2], ... and finish with a numbered "Sources" list (title, address, date when known) taken from your ledger. Never invent a source, a number or a quote.',
    opts.memory ? '9. If the research produced a lasting fact about this project, save it with `memory_add`.' : null,
  ]
    .filter(Boolean)
    .join('\n');
}
