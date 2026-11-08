import { useMemo, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import { groupDigits, prettyValue, truncateOutput } from '../../lib/format.ts';
import { toolFiles } from '../../lib/toolFiles.ts';
import type { ToolItem } from '../../lib/sessionState.ts';
import { TerminalIcon } from '../icons.tsx';
import { DiffView } from './DiffView.tsx';

/** Everything that can be long is cut to this many characters. */
export const OUTPUT_LIMIT = 20_000;

interface SearchResult {
  title: string;
  url: string;
  domain: string;
}

export function extractSearchResults(item: ToolItem): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const add = (url: string, rawTitle?: string) => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      const cleanUrl = parsed.href;
      if (seen.has(cleanUrl)) return;
      seen.add(cleanUrl);
      const domain = parsed.hostname.replace(/^www\./, '');
      const title = rawTitle && rawTitle.trim() ? rawTitle.trim() : domain;
      results.push({ title, url: cleanUrl, domain });
    } catch {}
  };

  const inspectText = (text: string) => {
    const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      add(match[2]!, match[1]);
    }
    const urlRegex = /(?<!\()(https?:\/\/[^\s<>"'\)]+)/g;
    while ((match = urlRegex.exec(text)) !== null) {
      add(match[1]!);
    }
  };

  if (item.rawOutput !== undefined) {
    if (typeof item.rawOutput === 'string') {
      inspectText(item.rawOutput);
    } else if (Array.isArray(item.rawOutput)) {
      for (const entry of item.rawOutput) {
        if (typeof entry === 'object' && entry !== null) {
          const rec = entry as Record<string, unknown>;
          const u = typeof rec['url'] === 'string' ? rec['url'] : typeof rec['link'] === 'string' ? rec['link'] : null;
          const tit = typeof rec['title'] === 'string' ? rec['title'] : typeof rec['name'] === 'string' ? rec['name'] : undefined;
          if (u) add(u, tit);
        }
      }
    } else if (typeof item.rawOutput === 'object' && item.rawOutput !== null) {
      const rec = item.rawOutput as Record<string, unknown>;
      const resultsArr = rec['results'] || rec['items'] || rec['organic'];
      if (Array.isArray(resultsArr)) {
        for (const entry of resultsArr) {
          if (typeof entry === 'object' && entry !== null) {
            const r = entry as Record<string, unknown>;
            const u = typeof r['url'] === 'string' ? r['url'] : typeof r['link'] === 'string' ? r['link'] : null;
            const tit = typeof r['title'] === 'string' ? r['title'] : typeof r['name'] === 'string' ? r['name'] : undefined;
            if (u) add(u, tit);
          }
        }
      }
    }
  }

  for (const block of item.content) {
    if (block.type === 'text') {
      inspectText(block.text);
    }
  }

  return results;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="text-xs font-medium text-text-muted">{label}</h3>
      {children}
    </section>
  );
}

/** Monospace text in its own scroll box (max height), capped at OUTPUT_LIMIT with a note. */
function Mono({ text }: { text: string }) {
  const cut = truncateOutput(text, OUTPUT_LIMIT);
  return (
    <div className="min-w-0">
      <pre className="max-h-80 overflow-auto rounded-md bg-bg-subtle px-2.5 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-text [overflow-wrap:anywhere]">
        {cut.text}
      </pre>
      {cut.hiddenChars > 0 && (
        <p className="mt-1 text-xs text-text-muted">{t('tool.truncated', { count: groupDigits(cut.hiddenChars) })}</p>
      )}
    </div>
  );
}

function Output({ item }: { item: ToolItem }) {
  const rawOutput = item.rawOutput;
  const raw = useMemo(() => (rawOutput === undefined ? null : prettyValue(rawOutput)), [rawOutput]);
  if (item.content.length === 0) return raw === null ? null : <Mono text={raw} />;
  return (
    <div className="space-y-2">
      {item.content.map((block, i) => {
        switch (block.type) {
          case 'text':
            return <Mono key={i} text={block.text} />;
          case 'diff':
            return <DiffView key={i} path={block.path} oldText={block.oldText} newText={block.newText} />;
          case 'terminal':
            return (
              <p key={i} className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                <TerminalIcon className="size-3.5 shrink-0" />
                <span className="truncate font-mono">{t('tool.terminal', { id: block.terminalId })}</span>
              </p>
            );
        }
      })}
    </div>
  );
}

/** The expanded body of a tool card: the raw input and what the tool produced. */
export function ToolDetails({ item }: { item: ToolItem }) {
  const isSearch = item.toolKind === 'search' || /^(search|search_web|web_search|browse)/i.test(item.title);
  const searchResults = useMemo(() => (isSearch ? extractSearchResults(item) : []), [isSearch, item]);
  const rawInput = item.rawInput;
  const input = useMemo(() => (rawInput === undefined ? null : prettyValue(rawInput)), [rawInput]);
  const hasInput = input !== null;
  const hasOutput = item.content.length > 0 || item.rawOutput !== undefined;
  // An edit the agent described only by its input (no diff block): show it as a diff instead of raw JSON.
  const derived = useMemo(() => (item.content.some((b) => b.type === 'diff') ? [] : toolFiles(item)), [item]);

  if (isSearch) {
    if (searchResults.length > 0) {
      return (
        <div className="space-y-2 py-1">
          <div className="text-[11px] font-medium text-text-muted">Araştırılan Sayfalar</div>
          <div className="flex flex-col gap-1.5">
            {searchResults.map((res, i) => (
              <a
                key={i}
                href={res.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-bg-subtle px-3 py-2 text-xs text-text transition hover:border-border hover:bg-bg-elevated"
              >
                <img
                  src={`https://www.google.com/s2/favicons?domain=${res.domain}&sz=32`}
                  alt=""
                  className="size-4 shrink-0 rounded"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
                <span className="truncate font-medium flex-1">{res.title}</span>
                <span className="shrink-0 text-[11px] text-text-muted">{res.domain}</span>
              </a>
            ))}
          </div>
          {hasOutput && searchResults.length === 0 && (
            <Section label={t('tool.output')}>
              <Output item={item} />
            </Section>
          )}
        </div>
      );
    }
    if (hasOutput) {
      return (
        <div className="space-y-3">
          <Section label={t('tool.output')}>
            <Output item={item} />
          </Section>
        </div>
      );
    }
    return <p className="text-xs text-text-muted">{t('tool.noDetails')}</p>;
  }

  if (!hasInput && !hasOutput && derived.length === 0) return <p className="text-xs text-text-muted">{t('tool.noDetails')}</p>;
  return (
    <div className="space-y-3">
      {derived.length > 0 && (
        <div className="space-y-2">
          {derived.flatMap((file) =>
            file.changes.map((change, i) => <DiffView key={`${file.path}:${i}`} path={file.path} oldText={change.oldText} newText={change.newText} />),
          )}
        </div>
      )}
      {hasInput && derived.length === 0 && (
        <Section label={t('tool.input')}>
          <Mono text={input} />
        </Section>
      )}
      {hasOutput && (
        <Section label={t('tool.output')}>
          <Output item={item} />
        </Section>
      )}
    </div>
  );
}
