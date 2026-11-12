import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronIcon, CheckIcon } from './icons.tsx';

export type SelectOption<V extends string = string> = { value: V; label: string; description?: string };

/**
 * A dropdown in the look of the model and effort picker: a trigger with the current choice and a card of options
 * (each with an optional line of explanation and a check on the current one), instead of the browser's own menu.
 * It is a listbox: Arrow keys move, Enter or Space choose, Escape closes.
 */
export function SettingsSelect<V extends string = string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  className = '',
  align = 'right',
}: {
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  /** The accessible name (what the setting is). */
  label: string;
  disabled?: boolean;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

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
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const choose = (next: V) => {
    close(true);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') return setOpen(false);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
    items[next]?.focus();
  };

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="select-trigger"
      >
        <span className="truncate">{current?.label}</span>
        <ChevronIcon className="size-3 shrink-0 text-text-muted" />
      </button>
      {open && (
        <div id={id} ref={list} role="listbox" aria-label={label} onKeyDown={onKeyDown} className={`picker-card picker-card-down select-card ${align === 'left' ? 'select-card-left' : ''}`}>
          <div className="picker-list">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => choose(o.value)}
                className="picker-item"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.description && <span className="block text-xs font-normal text-text-muted">{o.description}</span>}
                </span>
                <span aria-hidden="true" className="picker-check">
                  {o.value === value && <CheckIcon className="animate-pop size-3.5" />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
