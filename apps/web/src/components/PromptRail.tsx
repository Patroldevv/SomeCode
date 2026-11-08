import { t } from '../i18n/index.ts';
import type { Item } from '../lib/sessionState.ts';

export type PromptEntry = { index: number; key: string; text: string; reply: string };

const PREVIEW_CHARS = 200;
/** More ticks than this would not fit the rail; the oldest prompts drop off it. */
const MAX_TICKS = 40;
/** Markdown marks that would only be noise in a one-paragraph preview. */
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

/** The user's prompts in order, each with the start of the agent's answer that follows it. */
export function promptEntries(items: readonly { kind: string; key: string; text?: string }[]): PromptEntry[] {
  const entries: PromptEntry[] = [];
  items.forEach((item, index) => {
    if (item.kind !== 'user') return;
    const next = items.slice(index + 1).find((i) => i.kind === 'agent' || i.kind === 'user');
    const reply = next?.kind === 'agent' ? plain(next.text ?? '').slice(0, PREVIEW_CHARS) : '';
    entries.push({ index, key: item.key, text: (item.text ?? '').replace(/\s+/g, ' ').trim(), reply });
  });
  return entries;
}

/**
 * A thin rail of ticks on the left edge of the conversation, one per prompt: the tick of the prompt you are
 * reading is long, hovering (or focusing) one shows the prompt with the start of its answer, and a click jumps there.
 */
export function PromptRail({ prompts, activeKey, onJump }: { prompts: readonly PromptEntry[]; activeKey: string | null; onJump: (index: number) => void }) {
  if (prompts.length < 2) return null;
  const shown = prompts.slice(-MAX_TICKS);
  return (
    <nav className="prompt-rail" aria-label={t('rail.prompts')}>
      <ul>
        {shown.map((p) => (
          <li key={p.key}>
            <button type="button" className="prompt-tick" data-active={p.key === activeKey} aria-label={p.text.slice(0, 120)} onClick={() => onJump(p.index)}>
              <span className="prompt-tick-line" />
              <span className="prompt-card" role="presentation">
                <span className="prompt-card-title">{p.text}</span>
                {p.reply && <span className="prompt-card-reply">{p.reply}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
