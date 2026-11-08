import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';

/** A shell command shown as text with a copy button. A failing clipboard just leaves the text to select. */
export function CommandHint({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard unavailable or denied: the command stays visible and selectable.
    }
  };
  return (
    <span className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-xs [overflow-wrap:anywhere]">{command}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={t('copy.command')}
        title={t('copy.command')}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        {copied ? <span aria-live="polite">{t('copy.done')}</span> : t('copy.command')}
      </button>
    </span>
  );
}
