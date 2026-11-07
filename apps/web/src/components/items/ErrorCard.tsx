import type { ErrorCode } from '@somecode/protocol';
import { errorText } from '../../i18n/index.ts';
import { AlertIcon } from '../icons.tsx';

/** A failed turn: the code's one-sentence message only (never the raw server text). */
export function ErrorCard({ code }: { code: ErrorCode }) {
  return (
    <div
      role="alert"
      className="flex min-w-0 items-start gap-2 rounded-lg border border-danger/50 px-3.5 py-2.5 font-ui text-sm text-danger"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 [overflow-wrap:anywhere]">{errorText(code)}</p>
    </div>
  );
}
