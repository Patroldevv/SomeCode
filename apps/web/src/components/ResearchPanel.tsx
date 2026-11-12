import { useEffect, useState } from 'react';
import { t, type MessageKey } from '../i18n/index.ts';
import type { ServerSettings } from '../lib/api.ts';
import { ENGINE_LIST, EngineLogo, type EngineId } from './EngineLogos.tsx';
import { SymbolIcon, type SymbolName } from './SymbolIcon.tsx';

/** What a research may concentrate on; picked per research and written into the first message. */
export const FOCUS = ['academic', 'news', 'code', 'infra', 'community', 'official', 'data'] as const;
/** How the report should be written; picked per research. */
export const FORMATS = ['brief', 'detailed', 'table'] as const;
export type Format = (typeof FORMATS)[number];
export type Focus = (typeof FOCUS)[number];
const FOCUS_ICON: Record<Focus, SymbolName> = { academic: 'book', news: 'globe', code: 'code', infra: 'layers', community: 'chat', official: 'shield', data: 'diff' };
const DEPTHS = ['standard', 'deep', 'exhaustive'] as const;
const QUESTIONS = ['dr.q1', 'dr.q2', 'dr.q3', 'dr.q4', 'dr.q5'] as const;
const STARTERS: { key: MessageKey; text: MessageKey; icon: SymbolName }[] = [
  { key: 'dr.starter.compare', text: 'dr.starter.compareText', icon: 'diff' },
  { key: 'dr.starter.state', text: 'dr.starter.stateText', icon: 'refresh' },
  { key: 'dr.starter.repo', text: 'dr.starter.repoText', icon: 'code' },
  { key: 'dr.starter.verify', text: 'dr.starter.verifyText', icon: 'checkCircle' },
  { key: 'dr.starter.guide', text: 'dr.starter.guideText', icon: 'book' },
];

const DEFAULT_ENGINES: EngineId[] = ['google', 'yandex', 'bing', 'duckduckgo'];

/** The line a research asks instead of "what shall we build": a new question every few seconds. */
export function ResearchHeading() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setI((n) => (n + 1) % QUESTIONS.length), 4800);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="research-head">
      <span className="research-kicker">
        <SymbolIcon name="research" className="size-3.5" />
        {t('mode.deepResearch')}
      </span>
      <h1 key={i} className="new-chat-title research-question text-center">
        {t(QUESTIONS[i]!)}
      </h1>
      <p className="research-sub">{t('dr.sub')}</p>
    </div>
  );
}

/** Starting points: a click puts the beginning of a research question in the box. */
export function ResearchStarters({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="research-starters" role="group" aria-label={t('dr.starters')}>
      {STARTERS.map((s) => (
        <button key={s.key} type="button" className="research-starter" onClick={() => onPick(t(s.text))}>
          <SymbolIcon name={s.icon} className="size-3.5" />
          {t(s.key)}
        </button>
      ))}
    </div>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className="question-switch">
      <span className="question-switch-knob" />
    </button>
  );
}

/**
 * Everything a research can be set up with before it starts: the search platforms (with their logos), how deep it
 * goes, what kinds of sources to favour and whether the plan waits for approval. Platforms, depth and the plan switch
 * are the app's research settings (they are saved); the source focus belongs to this one research.
 */
export function ResearchPanel({
  settings,
  onSetting,
  focus,
  onFocus,
  format,
  onFormat,
  disabled = false,
}: {
  settings: ServerSettings | null;
  onSetting: (patch: Partial<ServerSettings>) => void;
  focus: Focus[];
  onFocus: (next: Focus[]) => void;
  format: Format | null;
  onFormat: (next: Format | null) => void;
  disabled?: boolean;
}) {
  const engines = settings?.researchEngines ?? DEFAULT_ENGINES;
  const depth = settings?.researchDepth ?? 'deep';
  const needsBrowser = settings !== null && settings.browserTool !== 'any';
  return (
    <section className="research-panel" aria-label={t('dr.panel')}>
      <div className="research-block">
        <h2 className="research-label">{t('dr.platforms')}</h2>
        <div className="research-engines" role="group" aria-label={t('dr.platforms')}>
          {ENGINE_LIST.map((e) => {
            const active = engines.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                className="research-engine"
                aria-pressed={active}
                disabled={disabled || (active && engines.length === 1)}
                onClick={() => onSetting({ researchEngines: active ? engines.filter((x) => x !== e.id) : ENGINE_LIST.map((x) => x.id).filter((x) => x === e.id || engines.includes(x)) })}
              >
                <EngineLogo id={e.id} className="size-[18px]" />
                {e.name}
                <span className="research-engine-tick" aria-hidden="true">
                  <SymbolIcon name="check" className="size-3" />
                </span>
              </button>
            );
          })}
        </div>
        {needsBrowser && (
          <p className="research-note">
            {t('dr.needsBrowser')}{' '}
            <button type="button" className="research-link" disabled={disabled} onClick={() => onSetting({ browserTool: 'any' })}>
              {t('dr.enableBrowser')}
            </button>
          </p>
        )}
      </div>

      <div className="research-block">
        <h2 className="research-label">{t('dr.depth')}</h2>
        <div className="research-depths" role="radiogroup" aria-label={t('dr.depth')}>
          {DEPTHS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={depth === d} className="research-depth" disabled={disabled} onClick={() => onSetting({ researchDepth: d })}>
              <span className="research-depth-name">{t(`research.depth.${d}` as MessageKey)}</span>
              <span className="research-depth-hint">{t(`research.depth.${d}Hint` as MessageKey)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="research-block">
        <h2 className="research-label">{t('dr.focus')}</h2>
        <div className="research-focus" role="group" aria-label={t('dr.focus')}>
          {FOCUS.map((f) => {
            const on = focus.includes(f);
            return (
              <button key={f} type="button" className="research-chip" aria-pressed={on} disabled={disabled} onClick={() => onFocus(on ? focus.filter((x) => x !== f) : [...focus, f])}>
                <SymbolIcon name={FOCUS_ICON[f]} className="size-3.5" />
                {t(`dr.focus.${f}` as MessageKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="research-block research-wide">
        <h2 className="research-label">{t('dr.format')}</h2>
        <div className="research-focus" role="radiogroup" aria-label={t('dr.format')}>
          {FORMATS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={format === f} className="research-chip" aria-pressed={format === f} disabled={disabled} onClick={() => onFormat(format === f ? null : f)}>
              {t(`dr.format.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="research-toggle">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-text">{t('research.plan')}</p>
          <p className="text-[12.5px] leading-snug text-text-muted">{t('dr.planHint')}</p>
        </div>
        <Switch label={t('research.plan')} checked={settings?.researchPlan ?? true} onChange={(v) => onSetting({ researchPlan: v })} />
      </div>
    </section>
  );
}

/** The first message with the chosen source focus and report format added as lines, so the agent (and the reader) can see them. */
export function withFocus(text: string, focus: Focus[], format: Format | null = null): string {
  const lines: string[] = [];
  if (focus.length > 0) lines.push(t('dr.focusLine', { list: focus.map((f) => t(`dr.focus.${f}` as MessageKey)).join(', ') }));
  if (format) lines.push(t('dr.formatLine', { format: t(`dr.format.${format}` as MessageKey) }));
  return lines.length === 0 ? text : `${text.trimEnd()}\n\n${lines.join('\n')}`;
}
