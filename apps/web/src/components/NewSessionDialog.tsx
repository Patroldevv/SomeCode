import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { errorText, t } from '../i18n/index.ts';
import { CommandHint } from './CommandHint.tsx';
import { ApiError, type AgentInfo } from '../lib/api.ts';
import { PRIMARY_BUTTON } from './EmptyState.tsx';

export type NewSessionInput = { agentId: string; name: string; path: string };

const FIELD =
  'rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text enabled:hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

/** The folder name of a path (`/home/u/app/` → `app`); the path itself when it has no segment (`/`). */
function lastSegment(path: string): string {
  return path.split('/').filter((s) => s !== '').pop() ?? path;
}

/**
 * Native modal `<dialog>` for starting a session, controlled by `open`. `onCreate` does the work and rejects
 * with an `ApiError` on failure (shown here with `errorText`, or handed to `onError` when the dialog was closed
 * meanwhile — a browser closes a modal on a second Escape even though `cancel` is prevented); on success the
 * dialog resets and calls `onClose`. The relative-path hint is only a hint: the server decides what a valid path is.
 */
export function NewSessionDialog({
  open,
  agents,
  onClose,
  onCreate,
  onError,
}: {
  open: boolean;
  agents: AgentInfo[];
  onClose: () => void;
  onCreate: (input: NewSessionInput) => Promise<void>;
  /** A failure that arrives after the dialog was closed: shown by the app (its error banner). */
  onError: (code: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hintId = useId();
  const [agentId, setAgentId] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setError(null);
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Only installed agents can be picked; until the user picks one, the first installed agent is selected.
  const selected = agents.some((a) => a.id === agentId && a.installed) ? agentId : (agents.find((a) => a.installed)?.id ?? '');
  const selectedHint = agents.find((a) => a.id === selected)?.signInHint;
  const trimmedPath = path.trim();
  const relative = trimmedPath !== '' && !trimmedPath.startsWith('/');
  const canSubmit = !busy && selected !== '' && trimmedPath !== '' && !relative;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ agentId: selected, name: name.trim() || lastSegment(trimmedPath), path: trimmedPath });
      setName('');
      setPath('');
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal';
      if (ref.current?.open) setError({ code, text: errorText(code) });
      else onError(code);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: the parent decides (keeps the element in sync with `open`); ignored while creating.
        e.preventDefault();
        if (!busyRef.current) onClose();
      }}
      onClose={() => {
        // Closed by the browser itself (not through `open`): tell the parent.
        if (open) onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-bg-elevated p-0 text-text backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-5 font-ui">
        <h2 id={titleId} className="text-base font-semibold">
          {t('session.new')}
        </h2>
        <fieldset disabled={busy} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t('newSession.agent')}
            <select className={FIELD} value={selected} onChange={(e) => setAgentId(e.target.value)}>
              {agents.length === 0 && <option value="">{t('newSession.agentNone')}</option>}
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.installed}>
                  {a.installed ? a.label : `${a.label} (${t('newSession.agentNotInstalled')})`}
                </option>
              ))}
            </select>
          </label>
          {agents.find((a) => a.id === selected)?.auth === 'signed_out' && (
            <p role="note" className="-mt-2 text-xs text-warning">
              {t('newSession.signedOut')}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-sm">
              {t('newSession.projectPath')}
              <input
                className={`${FIELD} font-mono`}
                value={path}
                spellCheck={false}
                autoComplete="off"
                placeholder="/home/…"
                aria-invalid={relative ? 'true' : undefined}
                aria-describedby={relative ? hintId : undefined}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            {relative && (
              <span id={hintId} className="text-xs text-warning">
                {t('newSession.pathRelative')}
              </span>
            )}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {t('newSession.projectName')}
            <input
              className={FIELD}
              value={name}
              placeholder={trimmedPath && !relative ? lastSegment(trimmedPath) : t('newSession.projectNameHint')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </fieldset>
        {error && (
          <div role="alert" className="flex flex-col gap-1.5 text-sm text-danger">
            <p>{error.text}</p>
            {error.code === 'auth_required' && selectedHint && (
              <div className="flex min-w-0 flex-col gap-1 text-text">
                <p className="text-xs text-text-muted">{t('signin.instruction')}</p>
                <CommandHint command={selectedHint} />
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onClose}>
            {t('newSession.cancel')}
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={!canSubmit}>
            {busy ? t('newSession.creating') : t('newSession.create')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
