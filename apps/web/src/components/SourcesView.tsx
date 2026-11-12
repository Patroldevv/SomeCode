import { t, type MessageKey } from '../i18n/index.ts';
import type { ResearchWork } from '../lib/researchSources.ts';
import { safeHref } from '../lib/safeUrl.ts';
import { ENGINE_LIST, EngineLogo, type EngineId } from './EngineLogos.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

const host = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const engineId = (name: string): EngineId | null => {
  const n = name.toLowerCase();
  return ENGINE_LIST.find((e) => n.includes(e.id) || n.startsWith(e.name.toLowerCase()))?.id ?? null;
};

function Link({ url, children, className }: { url: string; children: React.ReactNode; className: string }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** The sources of a deep research as they come in: how far each is trusted, what it established, and a link to the page. */
export function SourcesView({ work }: { work: ResearchWork }) {
  const high = work.sources.filter((s) => s.confidence === 'high').length;
  return (
    <div className="sources-view">
      <header className="sources-head">
        <span className="sources-count">{work.sources.length}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-text">{t('sources.title')}</p>
          <p className="text-[12px] text-text-muted">{t('sources.summary', { high, pages: work.read.length + work.sources.length, searches: work.searches.length })}</p>
        </div>
        {work.busy && <span className="spin-arc size-4 text-accent" role="status" aria-label={t('sources.working')} />}
      </header>

      {work.sources.length === 0 && <p className="sources-empty">{t('sources.empty')}</p>}
      <ol className="sources-list">
        {work.sources.map((s, i) => (
          <li key={s.url} className="source-card" data-confidence={s.confidence} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
            <div className="source-top">
              <span className="source-no">{i + 1}</span>
              <Link url={s.url} className="source-title">
                {s.title}
              </Link>
              <SymbolIcon name="external" className="size-3 shrink-0 text-text-muted" />
            </div>
            <p className="source-host">{host(s.url)}</p>
            {s.finding && <p className="source-finding">{s.finding}</p>}
            <div className="source-meta">
              <span className="source-badge">{t(`sources.confidence.${s.confidence}` as MessageKey)}</span>
              {s.step !== undefined && <span className="text-text-muted">{t('sources.step', { n: s.step })}</span>}
            </div>
          </li>
        ))}
      </ol>

      {work.read.length > 0 && (
        <section className="sources-block">
          <h3 className="sources-label">{t('sources.read')}</h3>
          <ul className="sources-plain">
            {work.read.map((r) => (
              <li key={r.url} className="flex items-center gap-2">
                {r.running ? <span className="spin-arc size-3 text-accent" aria-hidden="true" /> : <SymbolIcon name="globe" className="size-3 shrink-0 text-text-muted" />}
                <Link url={r.url} className="truncate text-text-muted hover:text-text">
                  {host(r.url)}
                  {(() => {
                    try {
                      const p = new URL(r.url).pathname;
                      return p.length > 1 ? p : '';
                    } catch {
                      return '';
                    }
                  })()}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {work.searches.length > 0 && (
        <section className="sources-block">
          <h3 className="sources-label">{t('sources.searches')}</h3>
          <ul className="sources-queries">
            {work.searches.map((s, i) => {
              const id = engineId(s.engine);
              return (
                <li key={i} className="source-query" title={s.engine}>
                  {s.running ? <span className="spin-arc size-3 text-accent" aria-hidden="true" /> : id ? <EngineLogo id={id} className="size-3.5" /> : <SymbolIcon name="search" className="size-3.5 text-text-muted" />}
                  <span className="truncate">{s.query}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
