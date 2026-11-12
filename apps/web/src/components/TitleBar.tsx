import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { SidebarIcon } from './icons.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

export type MenuEntry =
  | { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { separator: true }
  | { heading: string };
export type MenuDef = { id: string; label: string; items: MenuEntry[] };

/** The menus along the top ("File", "Edit", ...): one opens on click, and the neighbours open as the pointer moves over them. */
function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={root} role="menubar" aria-label={t('titlebar.menus')} className="menubar">
      {menus.map((menu) => (
        <div key={menu.id} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            className="menubar-button"
            onClick={() => setOpen(open === menu.id ? null : menu.id)}
            onPointerEnter={() => open !== null && setOpen(menu.id)}
          >
            {menu.label}
          </button>
          {open === menu.id && (
            <div role="menu" aria-label={menu.label} className="menubar-menu">
              {menu.items.map((item, i) =>
                'separator' in item ? (
                  <div key={i} role="separator" className="profile-sep" />
                ) : 'heading' in item ? (
                  <p key={i} className="menubar-heading">{item.heading}</p>
                ) : (
                  <button
                    key={i}
                    type="button"
                    role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
                    disabled={item.disabled}
                    className="profile-item"
                    onClick={() => {
                      setOpen(null);
                      item.onSelect();
                    }}
                  >
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.checked && <SymbolIcon name="check" className="size-3.5 shrink-0" />}
                    {item.shortcut && <span className="profile-kbd">{item.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The strip across the top of the window: back and forward through the chats opened, the sidebar switch, and the menus.
 */
export function TitleBar({
  canBack,
  canForward,
  onBack,
  onForward,
  sidebarOpen,
  onToggleSidebar,
  menus,
}: {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  menus: MenuDef[];
}) {
  return (
    <header className="titlebar">
      <button type="button" className="titlebar-button" aria-label={t('titlebar.back')} title={t('titlebar.back')} disabled={!canBack} onClick={onBack}>
        <SymbolIcon name="arrow" className="size-4 -rotate-90" />
      </button>
      <button type="button" className="titlebar-button" aria-label={t('titlebar.forward')} title={t('titlebar.forward')} disabled={!canForward} onClick={onForward}>
        <SymbolIcon name="arrow" className="size-4 rotate-90" />
      </button>
      <button
        type="button"
        className="titlebar-button"
        aria-label={t('sidebar.toggle')}
        title={`${t('sidebar.toggle')} (Ctrl+B)`}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </button>
      <MenuBar menus={menus} />
    </header>
  );
}
