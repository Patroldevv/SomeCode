import type { ConfigOption } from '@somecode/protocol';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { t, type MessageKey } from '../i18n/index.ts';
import { CheckIcon } from './icons.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

const ICON = { ask: 'hand', auto: 'shield', full: 'alert' } as const;
type Level = keyof typeof ICON;
const isLevel = (v: string): v is Level => v in ICON;

/**
 * How much the agent may do without asking, as the access menu of the chat apps: ask for everything, approve the
 * safe things for me, or full access (shown in warning colours). The names come from our own strings, not the server's.
 */
export function ApprovalPicker({
  option,
  disabled,
  busy,
  onChange,
}: {
  option: ConfigOption;
  disabled: boolean;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current: Level = isLevel(option.currentValue) ? option.currentValue : 'ask';
  const name = (level: Level) => t(`approval.${level}` as MessageKey);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[e.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0)]?.focus();
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className="approval-chip"
        data-level={current}
        aria-label={t('approval.label', { value: name(current) })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <SymbolIcon name={ICON[current]} className="size-[15px]" />
        <span>{name(current)}</span>
      </button>
      {open && (
        <div ref={list} role="menu" aria-label={t('approval.title')} onKeyDown={onKeyDown} className="menu-card approval-menu">
          <p className="approval-title">{t('approval.title')}</p>
          {option.choices
            .filter((c) => isLevel(c.value))
            .map((c) => {
              const level = c.value as Level;
              return (
                <button
                  key={level}
                  type="button"
                  role="menuitemradio"
                  aria-checked={level === current}
                  data-level={level}
                  className="approval-item"
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                    onChange(level);
                  }}
                >
                  <SymbolIcon name={ICON[level]} className="size-[17px] shrink-0" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block">{name(level)}</span>
                    <span className="approval-desc">{t(`approval.${level}.hint` as MessageKey)}</span>
                  </span>
                  <span className="approval-check" aria-hidden="true">{level === current && <CheckIcon className="animate-pop size-3.5" />}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
