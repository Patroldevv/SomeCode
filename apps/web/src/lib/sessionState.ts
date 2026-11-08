// Shared with the durable server projection so snapshots and live events use identical semantics.
export { addLocalUserMessage, applyEvent, initialState, TRUNCATION_MARKER } from '@somecode/protocol';
export type { Item, ThoughtItem, ToolItem, ToolContentView, PlanEntry, PermissionOption, SessionStatus } from '@somecode/protocol';
import type { Item, SessionState as BaseSessionState } from '@somecode/protocol';
export type SessionState = BaseSessionState & {
  /** One separate page of older items; the recent window and its live cursor stay intact. */
  olderItems?: Item[];
  olderBeforeSeq?: number | null;
  historyLoading?: boolean;
  /** Durable creation seq for confirmed optimistic items whose React key remains local-N. */
  itemSeqs?: Record<string, number>;
};
