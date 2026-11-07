import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../i18n/index.ts';

const MAX_LINES = 12;
const FALLBACK_LINE_PX = 24;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** A turn is in flight: Send becomes Stop, Enter no longer sends (typing the next message stays possible). */
  running: boolean;
  disabled: boolean;
  /** Receives the trimmed text. The parent clears the draft; this component never edits `value` itself. */
  onSend: (text: string) => void;
  onCancel: () => void;
}

function maxHeightPx(el: HTMLTextAreaElement): number {
  const lh = Number.parseFloat(getComputedStyle(el).lineHeight); // NaN for 'normal' / in jsdom
  return (Number.isFinite(lh) && lh > 0 ? lh : FALLBACK_LINE_PX) * MAX_LINES;
}

const BASE_BUTTON =
  'shrink-0 rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

export function Composer({ value, onChange, running, disabled, onSend, onCancel }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Set on send, released when `value` changes: a second Enter before the parent clears the draft must not re-send. */
  const sentRef = useRef(false);
  const canSend = value.trim() !== '' && !running && !disabled;

  useEffect(() => {
    sentRef.current = false;
  }, [value]);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const max = maxHeightPx(el);
    el.style.height = 'auto';
    const h = Math.min(el.scrollHeight, max);
    el.style.height = `${h}px`;
    el.style.maxHeight = `${max}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const send = () => {
    if (!canSend || sentRef.current) return;
    sentRef.current = true;
    onSend(value.trim());
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME candidate confirmation, not a send
    if (e.shiftKey) return; // browser default: newline
    // Plain Enter never inserts a newline (only Shift+Enter does), even when it cannot send (running, empty,
    // disabled). Ctrl/Meta+Enter send like plain Enter; Alt+Enter is left alone.
    if (e.altKey) return;
    e.preventDefault();
    send();
  };

  return (
    <div className="font-ui">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 focus-within:outline-2 focus-within:outline-accent">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          aria-label={t('composer.label')}
          placeholder={t('chat.placeholder')}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-text outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
        />
        {running ? (
          <button type="button" onClick={onCancel} className={`${BASE_BUTTON} border border-border text-text hover:bg-bg-subtle`}>
            {t('composer.stop')}
          </button>
        ) : (
          <button type="button" disabled={!canSend} onClick={send} className={`${BASE_BUTTON} bg-accent text-bg enabled:hover:opacity-90`}>
            {t('chat.send')}
          </button>
        )}
      </div>
      <p className="mt-1 px-1 text-xs text-text-muted">{t('composer.hint')}</p>
    </div>
  );
}
