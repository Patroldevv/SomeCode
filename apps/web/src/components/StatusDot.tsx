import { t } from '../i18n/index.ts';
import type { SessionState } from '../lib/sessionState.ts';

export type DotStatus = 'running' | 'permission' | 'ready' | 'disconnected';

/** Disconnected wins, then an unresolved permission request (the agent waits on the user), then running. */
export function dotStatus(state: SessionState): DotStatus {
  if (state.status === 'disconnected') return 'disconnected';
  if (state.items.some((i) => i.kind === 'permission' && !i.resolved)) return 'permission';
  return state.status === 'running' ? 'running' : 'ready';
}

const COLOUR: Record<DotStatus, string> = {
  running: 'bg-accent motion-safe:animate-pulse',
  permission: 'bg-warning',
  ready: 'bg-success',
  disconnected: 'bg-danger',
};

/** Statuses shown by softly fading text instead of a light. */
export const isBusyStatus = (status: DotStatus): boolean => status === 'running' || status === 'permission';

/**
 * A session's status with an accessible name. `quiet` keeps the name for assistive tech but draws nothing for
 * the calm and busy states (the caller fades the label text for those); a lost connection always shows red.
 */
export function StatusDot({ state, quiet = false }: { state: SessionState; quiet?: boolean }) {
  const status = dotStatus(state);
  const label = t(`session.status.${status}`);
  if (quiet && status !== 'disconnected') {
    return <span role="img" aria-label={label} data-status={status} className="sr-only" />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-status={status}
      className={`inline-block size-2 shrink-0 rounded-full ${COLOUR[status]}`}
    />
  );
}

/** The dot of a session whose live status is not tracked (only the active session's is, in this stage). */
export function NeutralDot() {
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-border" />;
}
