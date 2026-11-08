import type { ConfigOption } from '@somecode/protocol';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { t } from '../i18n/index.ts';
import { chipLabel } from '../lib/configChips.ts';
import { CheckIcon, ChevronIcon } from './icons.tsx';

const DEFAULT_CHOICE = /^(default|auto|recommended|varsay[ıi]lan)$/i;
const isDefaultChoice = (c: { value: string; name: string }) => DEFAULT_CHOICE.test(c.value) || DEFAULT_CHOICE.test(c.name);

/** The effort step that gets the violet bar. */
const MAX_STEP = /^(max|maximum|xhigh|ultra)$/i;
export const isMaxStep = (c: { value: string; name: string } | undefined) => !!c && (MAX_STEP.test(c.value) || MAX_STEP.test(c.name));

export function isEffortMax(step: { value: string; name: string } | undefined, index: number, totalSteps: number): boolean {
  if (!step || totalSteps <= 1) return false;
  if (isMaxStep(step)) return true;
  if (index === totalSteps - 1 && !DEFAULT_CHOICE.test(step.value)) return true;
  return false;
}

/** Model lists longer than this get a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * One composer control for the model and its reasoning effort, like the chat apps it follows. The trigger shows
 * "<model> <effort>"; it opens a small card with the effort as a stepped slider and the model name underneath.
 * Pressing the model name swaps the card for the list of models. The shown values only ever come from the agent's
 * own options: a slider move is a request, and the card keeps the dragged position only until the agent answers.
 */
export function ModelPicker({
  model,
  effort,
  disabled,
  pendingId,
  onChange,
}: {
  model: ConfigOption;
  /** Absent for a model without reasoning levels: the control then opens straight onto the model list. */
  effort?: ConfigOption;
  disabled: boolean;
  pendingId: string | null;
  onChange: (configId: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'effort' | 'models'>(effort ? 'effort' : 'models');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const modelLabel = chipLabel(model).value;
  const effortLabel = effort ? chipLabel(effort).value : '';
  const busy = pendingId === model.id || (effort !== undefined && pendingId === effort.id);
  const currentEffortIndex = effort ? Math.max(0, effort.choices.findIndex((c) => c.value === effort.currentValue)) : 0;
  const isCurrentMax = effort ? isEffortMax(effort.choices[currentEffortIndex], currentEffortIndex, effort.choices.length) : false;
  const label = effort ? t('config.picker', { model: modelLabel, effort: effortLabel }) : t('config.chipLabel', { name: model.name, value: modelLabel });

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const toggle = () => {
    if (open) return close(false);
    setView(effort ? 'effort' : 'models');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const target =
      card.current?.querySelector<HTMLElement>('input[type="text"]') ??
      card.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      card.current?.querySelector<HTMLElement>('input[type="range"]');
    target?.focus();
  }, [open, view]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (view === 'models' && effort) {
        setView('effort');
      } else {
        close(true);
      }
      return;
    }
    if (view !== 'models' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const focusables = [...(card.current?.querySelectorAll<HTMLElement>('input[type="text"], [role="menuitemradio"]') ?? [])];
    if (focusables.length === 0) return;
    e.preventDefault();
    const at = focusables.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? focusables.length - 1 : e.key === 'ArrowDown' ? Math.min(at + 1, focusables.length - 1) : Math.max(at - 1, 0);
    focusables[next]?.focus();
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={busy}
        disabled={disabled}
        onClick={toggle}
        className="picker-trigger"
      >
        <span className="text-text">{modelLabel}</span>
        {effort && <span className={isCurrentMax ? 'font-medium text-violet' : 'text-text-muted'}>{effortLabel}</span>}
        <ChevronIcon className={`size-3 text-text-muted motion-safe:transition-transform motion-safe:duration-200 ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {open && (
        <div
          ref={card}
          role="dialog"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="picker-card"
        >
          {view === 'effort' && effort ? (
            <EffortView
              key="effort"
              effort={effort}
              modelLabel={modelLabel}
              busy={busy}
              onPickModel={() => setView('models')}
              onCommit={(value) => onChange(effort.id, value)}
            />
          ) : (
            <ModelList
              key="models"
              model={model}
              {...(effort ? { onBack: () => setView('effort') } : {})}
              onSelect={(value) => {
                onChange(model.id, value);
                close(true);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EffortView({
  effort,
  modelLabel,
  busy,
  onPickModel,
  onCommit,
}: {
  effort: ConfigOption;
  modelLabel: string;
  busy: boolean;
  onPickModel: () => void;
  onCommit: (value: string) => void;
}) {
  const steps = effort.choices;
  const current = Math.max(
    0,
    steps.findIndex((c) => c.value === effort.currentValue),
  );
  const [draft, setDraft] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const shown = draft ?? current;
  const sliderId = useId();

  // Once the agent has answered (or the request failed) the card goes back to showing the agent's own value.
  useEffect(() => {
    if (!busy) setDraft(null);
  }, [busy, current]);

  const commit = () => {
    if (draft === null || draft === current) return;
    const step = steps[draft];
    if (step) onCommit(step.value);
  };
  const last = Math.max(steps.length - 1, 1);
  const isMax = isEffortMax(steps[shown], shown, steps.length);

  return (
    <div className="picker-view">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p key={steps[shown]?.value} className={`effort-title truncate text-[15px] font-medium ${isMax ? 'text-violet' : 'text-text'}`}>
            {steps[shown]?.name}
          </p>
          <button type="button" onClick={onPickModel} className="picker-model-link">
            <span className="truncate">{modelLabel}</span>
            <ChevronIcon className="size-3 shrink-0" />
          </button>
        </div>
      </div>
      <div
        className={`effort-slider mt-4 ${isMax ? 'effort-max' : ''} ${dragging ? 'effort-dragging' : ''}`}
        style={{ '--p': shown / last } as CSSProperties}
      >
        <div className="effort-track" aria-hidden="true">
          <div className="effort-fill" />
          {steps.map((step, i) => (
            <span key={step.value} className={`effort-dot ${i < shown ? 'effort-dot-on' : ''} ${i === shown ? 'effort-dot-hidden' : ''}`} style={{ '--i': i / last } as CSSProperties} />
          ))}
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={shown}
          aria-label={effort.name}
          aria-valuetext={steps[shown]?.name}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerMove={(e) => {
            if (e.buttons === 1) setDragging(true);
          }}
          onPointerCancel={() => setDragging(false)}
          onPointerUp={() => {
            setDragging(false);
            commit();
          }}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span className="effort-thumb" aria-hidden="true" />
      </div>
    </div>
  );
}

function ModelList({ model, onBack, onSelect }: { model: ConfigOption; onBack?: () => void; onSelect: (value: string) => void }) {
  const [filter, setFilter] = useState('');
  const showFilter = model.choices.length > FILTER_THRESHOLD;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matching = q ? model.choices.filter((i) => `${i.name} ${i.value}`.toLowerCase().includes(q)) : model.choices;
    // "Default"-like choices come first (stable sort keeps the agent's order for the rest).
    return [...matching].sort((a, b) => Number(isDefaultChoice(b)) - Number(isDefaultChoice(a)));
  }, [model.choices, filter]);

  return (
    <div className="picker-view">
      <div className="mb-1 flex items-center gap-1.5 px-1">
        {onBack && (
          <button type="button" aria-label={t('config.back')} onClick={onBack} className="icon-button -ml-1 size-6">
            <ChevronIcon className="size-3 rotate-180" />
          </button>
        )}
        <p className="text-xs font-medium text-text-muted">{t('config.pickModel')}</p>
      </div>
      {showFilter && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t('config.filter')}
          placeholder={t('config.filter')}
          className="picker-filter"
        />
      )}
      <div role="menu" aria-label={t('config.pickModel')} className="picker-list">
        {visible.length === 0 && <p className="px-2 py-1.5 text-sm text-text-muted">{t('config.noMatch')}</p>}
        {visible.map((item) => (
          <button
            key={item.value}
            type="button"
            role="menuitemradio"
            aria-checked={item.value === model.currentValue}
            onClick={() => onSelect(item.value)}
            className="picker-item"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.name}</span>
              {item.description && <span className="block truncate text-xs font-normal text-text-muted">{item.description}</span>}
            </span>
            <span aria-hidden="true" className="picker-check">
              {item.value === model.currentValue && <CheckIcon className="animate-pop size-3.5" />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
