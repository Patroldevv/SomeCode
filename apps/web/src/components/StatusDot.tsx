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

/** A session's status as a small coloured dot with an accessible name; the pulse respects reduced motion. */
export function StatusDot({ state }: { state: SessionState }) {
  const status = dotStatus(state);
  const label = t(`session.status.${status}`);
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
