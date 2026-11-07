import { t } from '../../i18n/index.ts';

/**
 * The user's prompt: a quiet, right-aligned block in the subtle surface, as plain text. `local` (not yet
 * confirmed by the server) is shown slightly dimmer.
 */
export function UserMessage({ text, local = false }: { text: string; local?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={`max-w-[85%] min-w-0 rounded-lg bg-bg-subtle px-3.5 py-2 font-ui text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${local ? 'text-text-muted' : 'text-text'}`}
      >
        <span className="sr-only">{t('item.user')}: </span>
        {text}
      </div>
    </div>
  );
}
