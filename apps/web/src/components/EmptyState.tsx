import { t } from '../i18n/index.ts';

export const PRIMARY_BUTTON =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg enabled:hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

/** The main column when no session is active. */
export function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center font-ui">
      <h1 className="font-voice text-2xl text-text">{t('empty.heading')}</h1>
      <p className="max-w-md text-sm text-text-muted">{t('empty.body')}</p>
      <button type="button" onClick={onNewSession} className={`${PRIMARY_BUTTON} mt-2`}>
        {t('session.new')}
      </button>
    </div>
  );
}
