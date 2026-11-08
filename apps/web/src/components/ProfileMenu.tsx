import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import type { ConnectionState } from '../lib/connection.ts';
import { SymbolIcon } from './SymbolIcon.tsx';

const DOT: Record<ConnectionState, string> = {
  connecting: 'bg-warning',
  open: 'bg-success',
  reconnecting: 'bg-warning',
  closed: 'bg-danger',
};

/** The round profile button at the top of the rail: the connection at a glance, and a menu with Settings and the theme. */
export function ProfileMenu({
  connection,
  light,
  onOpenSettings,
  onTheme,
}: {
  connection: ConnectionState;
  light: boolean;
  onOpenSettings: () => void;
  onTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const initial = t('app.title').slice(0, 1);
  const status = connection === 'open' ? t('account.local') : t(`connection.${connection}`);
  return (
    <div ref={root} className="profile">
      <button type="button" className="profile-button" aria-label={t('account.profile')} title={t('account.profile')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="profile-avatar" aria-hidden="true">
          {initial}
          <span className={`profile-dot ${DOT[connection]}`} />
        </span>
        <span className="sr-only">{t('connection.label')}: {t(`connection.${connection}`)}</span>
      </button>
      {open && (
        <div role="menu" aria-label={t('account.profile')} className="profile-menu">
          <div className="profile-head">
            <span className="profile-avatar profile-avatar-lg" aria-hidden="true">{initial}</span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium text-text">{t('app.title')}</span>
              <span className="block truncate text-[13px] text-text-muted">{status}</span>
            </span>
          </div>
          <div className="profile-sep" />
          <button type="button" role="menuitem" className="profile-item" onClick={() => { setOpen(false); onOpenSettings(); }}>
            <SymbolIcon name="gear" className="size-[17px]" />
            <span className="flex-1 text-left">{t('account.settings')}</span>
            <span className="profile-kbd">Ctrl+,</span>
          </button>
          <button type="button" role="menuitem" className="profile-item" onClick={() => { setOpen(false); onTheme(); }}>
            <SymbolIcon name={light ? 'moon' : 'sun'} className="size-[17px]" />
            <span className="flex-1 text-left">{t('account.theme')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
