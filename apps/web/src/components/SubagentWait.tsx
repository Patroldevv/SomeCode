import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { SymbolIcon } from './SymbolIcon.tsx';

/** "45 s", "2 min 05 s" (the units come from the UI language). */
export function waitLabel(seconds: number): string {
  if (seconds < 60) return t('subagent.wait.s', { s: seconds });
  return t('subagent.wait.m', { m: Math.floor(seconds / 60), s: String(seconds % 60).padStart(2, '0') });
}

/**
 * While sub-agents are still working, the conversation says so ("Waiting for sub-agents… 30 s") with a clock that
 * runs until the last one is done, instead of looking finished after the agent's hand-off message.
 */
export function SubagentWait({ running, now = Date.now }: { running: number; now?: () => number }) {
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  const active = running > 0;
  useEffect(() => {
    if (!active) {
      setSince(null);
      return;
    }
    setSince((s) => s ?? now());
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active, now]);
  if (!active) return null;
  const seconds = since === null ? 0 : Math.max(0, Math.floor((now() - since) / 1000));
  const time = waitLabel(seconds);
  const label = running === 1 ? t('subagent.wait.single', { time }) : t('subagent.wait.multiple', { time });
  return (
    <div role="status" className="subagent-wait">
      <span className="loading-ring size-3.5 border-[1.5px] text-accent shrink-0" />
      <span className="status-fade">
        {label}
      </span>
      {running > 1 && <span className="text-text-muted font-normal">· {t('subagent.running', { count: running })}</span>}
    </div>
  );
}
