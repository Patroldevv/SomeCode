const KEY = 'somecode.activeSession';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Even reading `sessionStorage` can throw (blocked storage), so it is resolved lazily inside try. */
type GetStorage = () => StorageLike;
const browserStorage: GetStorage = () => sessionStorage;

/**
 * The session shown in this tab, kept next to the token in sessionStorage so a reload (F5)
 * re-subscribes to it. Storage failures are swallowed: the page then simply starts empty.
 */
export function loadActiveSession(storage: GetStorage = browserStorage): string | null {
  try {
    return storage().getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function saveActiveSession(sessionId: string, storage: GetStorage = browserStorage): void {
  try {
    storage().setItem(KEY, sessionId);
  } catch {
    // Not persisted; only this page load knows the session.
  }
}

export function clearActiveSession(storage: GetStorage = browserStorage): void {
  try {
    storage().removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
