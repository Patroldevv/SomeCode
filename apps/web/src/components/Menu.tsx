import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';

export type MenuItem = { value: string; name: string; description?: string };

/** Menus longer than this get a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * A button that opens an upward menu of radio items. Keyboard: arrows/Home/End move, Enter selects, Esc closes and
 * returns focus to the button; a click outside closes. Agent-supplied names are always rendered as text.
 */
export function Menu({
  label,
  items,
  selected,
  disabled,
  busy,
  onSelect,
  children,
}: {
  label: string;
  items: MenuItem[];
  selected: string;
  disabled: boolean;
  busy: boolean;
  onSelect: (value: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const showFilter = items.length > FILTER_THRESHOLD;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((i) => `${i.name} ${i.value}`.toLowerCase().includes(q)) : items;
  }, [items, filter]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setFilter('');
    if (restoreFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusables = list.current?.querySelectorAll<HTMLElement>('input, [role="menuitemradio"]');
    const first = showFilter ? list.current?.querySelector<HTMLElement>('input') : null;
    const checked = list.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (first ?? checked ?? focusables?.[0])?.focus();
  }, [open, showFilter]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const focusables = [...(list.current?.querySelectorAll<HTMLElement>('input, [role="menuitemradio"]') ?? [])];
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="picker-trigger"
      >
        {children}
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="menu-card"
        >
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
          {visible.length === 0 && <p className="px-2 py-1.5 text-sm text-text-muted">{t('config.noMatch')}</p>}
          {visible.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.value === selected}
              onClick={() => {
                onSelect(item.value);
                close(true);
              }}
              className="picker-item menu-item"
            >
              <span className="block min-w-0 flex-1 text-left">
                <span className="block truncate">{item.name}</span>
                {item.description && <span className="block truncate text-xs font-normal text-text-muted">{item.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
