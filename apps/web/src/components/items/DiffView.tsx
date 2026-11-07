import { useMemo } from 'react';
import { t } from '../../i18n/index.ts';
import { buildDiff, type DiffLine } from '../../lib/diffView.ts';

// Tints derived from the status tokens, so both themes follow automatically.
const ADD_BG = 'bg-[color-mix(in_srgb,var(--success)_13%,transparent)]';
const DEL_BG = 'bg-[color-mix(in_srgb,var(--danger)_13%,transparent)]';
const ROW = 'flex whitespace-pre no-underline pr-3';
const GUTTER = 'w-6 shrink-0 select-none text-center';

function Row({ line }: { line: DiffLine }) {
  switch (line.type) {
    case 'add':
      return (
        <ins className={`${ROW} ${ADD_BG} text-text`}>
          <span className={`${GUTTER} text-success`} aria-hidden="true">
            +
          </span>
          <span className="sr-only">{t('diff.added')}: </span>
          <span>{line.text}</span>
        </ins>
      );
    case 'del':
      return (
        <del className={`${ROW} ${DEL_BG} text-text`}>
          <span className={`${GUTTER} text-danger`} aria-hidden="true">
            -
          </span>
          <span className="sr-only">{t('diff.removed')}: </span>
          <span>{line.text}</span>
        </del>
      );
    case 'context':
      return (
        <div className={`${ROW} text-text-muted`}>
          <span className={GUTTER} aria-hidden="true" />
          <span>{line.text}</span>
        </div>
      );
    case 'gap':
      return (
        <div className={`${ROW} bg-bg-subtle text-text-muted`} title={t('diff.gap')}>
          <span className={GUTTER} aria-hidden="true" />
          <span aria-hidden="true">…</span>
          <span className="sr-only">{t('diff.gap')}</span>
        </div>
      );
  }
}

/**
 * Inline unified diff of one file edit: path header, `+`/`-` gutter AND tint, `…` for hidden unchanged lines.
 * Bounded by `buildDiff` (lines, per-line and total characters); a note says when something was cut.
 */
export function DiffView({ path, oldText, newText }: { path: string; oldText: string | null; newText: string }) {
  const { lines, truncated } = useMemo(() => buildDiff(oldText, newText), [oldText, newText]);
  return (
    <figure className="min-w-0 overflow-hidden rounded-md border border-border bg-bg font-mono text-xs leading-5">
      <figcaption className="flex min-w-0 items-center gap-2 border-b border-border bg-bg-subtle px-2.5 py-1 text-text-muted">
        <span className="min-w-0 truncate" title={path}>
          {path}
        </span>
        {oldText === null && (
          <span className="shrink-0 rounded border border-border px-1.5 font-ui text-[0.6875rem] leading-4">
            {t('diff.newFile')}
          </span>
        )}
      </figcaption>
      {lines.length === 0 ? (
        <p className="px-2.5 py-1.5 font-ui text-text-muted">{t('diff.noChanges')}</p>
      ) : (
        <div className="max-h-96 overflow-auto py-1">
          <div className="min-w-max">
            {lines.map((line, i) => (
              <Row key={i} line={line} />
            ))}
          </div>
        </div>
      )}
      {truncated && (
        <p className="border-t border-border px-2.5 py-1 font-ui text-text-muted">{t('diff.truncated')}</p>
      )}
    </figure>
  );
}
