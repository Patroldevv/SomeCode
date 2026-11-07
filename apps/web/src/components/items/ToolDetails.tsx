import type { ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import { groupDigits, prettyValue, truncateOutput } from '../../lib/format.ts';
import type { ToolItem } from '../../lib/sessionState.ts';
import { TerminalIcon } from '../icons.tsx';
import { DiffView } from './DiffView.tsx';

/** Everything that can be long is cut to this many characters. */
export const OUTPUT_LIMIT = 20_000;

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
  if (item.content.length === 0) {
    return item.rawOutput === undefined ? null : <Mono text={prettyValue(item.rawOutput)} />;
  }
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
  const hasInput = item.rawInput !== undefined;
  const hasOutput = item.content.length > 0 || item.rawOutput !== undefined;
  if (!hasInput && !hasOutput) return <p className="text-xs text-text-muted">{t('tool.noDetails')}</p>;
  return (
    <div className="space-y-3">
      {hasInput && (
        <Section label={t('tool.input')}>
          <Mono text={prettyValue(item.rawInput)} />
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
