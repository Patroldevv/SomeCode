import { t } from '../i18n/index.ts';
import type { Toast } from '../hooks/useAlerts.ts';
import { CheckIcon, CrossIcon } from './icons.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

const ICON = {
  done: <CheckIcon className="size-4" />,
  ask: <SymbolIcon name="chat" className="size-4" />,
  error: <CrossIcon className="size-4" />,
  limit: <SymbolIcon name="ring" className="size-4" />,
} as const;

/** Small cards in the bottom-right corner; one that belongs to a chat opens it when pressed. */
export function Toasts({ toasts, onOpen, onDismiss }: { toasts: Toast[]; onOpen: (sessionId: string) => void; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon" aria-hidden="true">{ICON[toast.kind]}</span>
          <button
            type="button"
            className="toast-text"
            disabled={!toast.sessionId}
            onClick={() => {
              if (toast.sessionId) onOpen(toast.sessionId);
              onDismiss(toast.id);
            }}
          >
            {toast.text}
          </button>
          <button type="button" className="icon-button size-6" aria-label={t('error.dismiss')} onClick={() => onDismiss(toast.id)}>
            <SymbolIcon name="close" className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
