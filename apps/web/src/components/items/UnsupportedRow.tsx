import { t } from '../../i18n/index.ts';
import { DotIcon } from '../icons.tsx';

/** An update this UI cannot show yet: one muted line, with the raw `sessionUpdate` tag as secondary text. */
export function UnsupportedRow({ sessionUpdate }: { sessionUpdate: string }) {
  return (
    <p className="flex min-w-0 items-center gap-2 font-ui text-xs text-text-muted">
      <DotIcon className="size-3.5 shrink-0" />
      <span className="shrink-0">{t('item.unsupported')}</span>
      <span className="min-w-0 truncate font-mono" title={sessionUpdate}>
        {sessionUpdate}
      </span>
    </p>
  );
}
