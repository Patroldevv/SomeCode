import type { StorageLike } from './activeSession.ts';

const KEY = 'somecode.sidebarOpen';

/** Resolved lazily inside try: even reading `localStorage` can throw when storage is blocked. */
type GetStorage = () => StorageLike;
const browserStorage: GetStorage = () => localStorage;

/** Whether the sidebar is open; a preference across page loads (localStorage), open by default. */
export function loadSidebarOpen(storage: GetStorage = browserStorage): boolean {
  try {
    return storage().getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveSidebarOpen(open: boolean, storage: GetStorage = browserStorage): void {
  try {
    storage().setItem(KEY, open ? '1' : '0');
  } catch {
    // Not persisted: the toggle still works for this page load.
  }
}
