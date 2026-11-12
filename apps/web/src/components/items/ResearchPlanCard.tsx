import { useEffect, useRef, useState } from 'react';
import type { FormAnswer } from '@somecode/protocol';
import { t } from '../../i18n/index.ts';
import type { Item } from '../../lib/sessionState.ts';
import { SymbolIcon } from '../SymbolIcon.tsx';
import { useResearchControl } from './ResearchContext.tsx';

type PermissionItem = Extract<Item, { kind: 'permission' }>;

/** A plan nobody answers starts by itself after this long, like the research plans of the chat apps this follows. */
export const AUTO_START_SECONDS = 90;
const RING = 2 * Math.PI * 11;

/**
 * The plan a deep research proposes: its steps as a list, with Edit (change, add, remove steps), Cancel and Start.
 * Start waits the countdown out when nobody answers, but any edit stops the clock. Once answered the card shrinks to
 * the steps that were approved (or says it was cancelled).
 */
const cancelledNow = (item: PermissionItem): boolean => item.resolved && item.answer === undefined;

/** The mark in front of a step: dashed ring (waiting), a turning arc (being worked on) or a tick (done). */
function StepMark({ status, running }: { status: string | undefined; running: boolean }) {
  if (status === 'in_progress' && !running) {
    // The agent is no longer working: the step is where it stopped, not spinning.
    return <span className="plan-mark"><span className="plan-bullet plan-bullet-stopped" aria-hidden="true" /></span>;
  }
  if (status === 'in_progress') {
    return (
      <span className="plan-mark" role="status" aria-label={t('plan.status.in_progress')}>
        <span className="spin-arc plan-spinner" aria-hidden="true" />
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="plan-mark plan-mark-done" role="img" aria-label={t('plan.status.completed')}>
        <SymbolIcon name="check" className="size-3" />
      </span>
    );
  }
  return <span className="plan-mark"><span className="plan-bullet" aria-hidden="true" /></span>;
}

export function ResearchPlanCard({
  item,
  answered,
  onRespond,
}: {
  item: PermissionItem;
  answered: boolean;
  onRespond: (requestId: string, optionId: string | null, answer?: FormAnswer) => void;
}) {
  const plan = item.plan!;
  const control = useResearchControl();
  const [steps, setSteps] = useState(plan.steps);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [left, setLeft] = useState(AUTO_START_SECONDS);
  const [paused, setPaused] = useState(false);
  const editing = draft !== null;
  const sent = useRef(false);
  const live = !item.resolved && !answered;

  const start = (list: string[]) => {
    const clean = list.map((s) => s.trim()).filter(Boolean);
    if (sent.current || clean.length === 0) return;
    sent.current = true;
    onRespond(item.requestId, 'start', { steps: clean });
  };

  useEffect(() => {
    if (!live || editing || paused) return;
    const timer = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [live, editing, paused]);
  useEffect(() => {
    if (live && !editing && !paused && left <= 0) start(steps);
    // `start` only reads refs and props that change together with `left`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const shown = item.resolved && Array.isArray(item.answer?.['steps']) ? (item.answer!['steps'] as string[]) : steps;
  // Once started, the agent ticks the steps off: a spinner marks the one it is working on.
  const marks = item.resolved && !cancelledNow(item) ? item.progress : undefined;
  const done = marks?.filter((m) => m.status === 'completed').length ?? 0;
  const finished = marks !== undefined && marks.length > 0 && done === marks.length;
  const cancelled = cancelledNow(item);
  const update = (i: number, text: string) => setDraft((d) => d?.map((s, k) => (k === i ? text : s)) ?? d);

  return (
    <section
      className="plan-card"
      data-pending={live}
      data-state={item.resolved ? (cancelled ? 'cancelled' : 'started') : 'open'}
      aria-label={t('rplan.heading')}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <header className="plan-head">
        <span className="plan-icon" aria-hidden="true">
          <SymbolIcon name="research" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="plan-title">{item.title}</p>
          <p className="plan-sub">
            {item.resolved
              ? cancelled
                ? t('rplan.cancelled')
                : finished
                  ? t('rplan.finished')
                  : marks
                    ? control.running
                      ? t('rplan.progress', { done, total: marks.length })
                      : t('rplan.stopped', { done, total: marks.length })
                    : t('rplan.started')
              : t('rplan.stepsCount', { count: steps.length })}
          </p>
        </div>
      </header>

      {editing ? (
        <ol className="plan-steps plan-steps-edit">
          {draft.map((text, i) => (
            <li key={i} className="plan-step">
              <span className="plan-step-no">{i + 1}</span>
              <textarea
                className="plan-input"
                rows={2}
                value={text}
                aria-label={t('rplan.step', { n: i + 1 })}
                onChange={(e) => update(i, e.target.value)}
              />
              <button type="button" className="plan-mini" aria-label={t('rplan.removeStep')} title={t('rplan.removeStep')} onClick={() => setDraft((d) => d?.filter((_, k) => k !== i) ?? d)}>
                <SymbolIcon name="close" className="size-3.5" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="plan-steps">
          {shown.map((text, i) => (
            <li key={i} className="plan-step" style={{ animationDelay: `${Math.min(i, 10) * 45}ms` }}>
              <StepMark status={marks?.[i]?.status} running={control.running} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
            </li>
          ))}
        </ol>
      )}

      {item.resolved && !cancelled && !finished && control.running && control.stop && (
        <footer className="plan-foot">
          <span className="flex-1" />
          <button type="button" className="plan-btn" onClick={control.stop}>
            <SymbolIcon name="stop" className="size-3 fill-current" /> {t('rplan.stop')}
          </button>
        </footer>
      )}
      {live && (
        <footer className="plan-foot">
          {editing ? (
            <>
              <button type="button" className="plan-btn" onClick={() => setDraft((d) => [...(d ?? []), ''])}>
                <SymbolIcon name="plus" className="size-3.5" /> {t('rplan.addStep')}
              </button>
              <span className="flex-1" />
              <button type="button" className="plan-btn" onClick={() => setDraft(null)}>
                {t('rplan.discard')}
              </button>
              <button
                type="button"
                className="plan-btn plan-btn-main"
                disabled={!draft.some((s) => s.trim())}
                onClick={() => {
                  const clean = draft.map((s) => s.trim()).filter(Boolean);
                  setSteps(clean);
                  setDraft(null);
                }}
              >
                {t('rplan.save')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="plan-btn" onClick={() => setDraft([...steps])}>
                <SymbolIcon name="edit" className="size-3.5" /> {t('rplan.edit')}
              </button>
              <span className="flex-1" />
              <button type="button" className="plan-btn" disabled={answered} onClick={() => onRespond(item.requestId, null)}>
                {t('rplan.cancel')}
              </button>
              <button type="button" className="plan-btn plan-btn-main" disabled={answered} onClick={() => start(steps)} title={paused ? t('rplan.paused') : t('rplan.auto', { seconds: Math.max(left, 0) })}>
                {t('rplan.start')}
                <span className="plan-count" aria-hidden="true" data-paused={paused}>
                  <svg viewBox="0 0 26 26">
                    <circle className="ring-track" cx="13" cy="13" r="11" />
                    <circle className="ring-run" cx="13" cy="13" r="11" strokeDasharray={RING} strokeDashoffset={RING * (1 - Math.max(left, 0) / AUTO_START_SECONDS)} />
                  </svg>
                  {Math.max(left, 0)}
                </span>
              </button>
            </>
          )}
        </footer>
      )}
    </section>
  );
}
