/** The order the user gave their projects and, per project, their sessions (ids), kept in the browser. */
export type SidebarOrder = { projects: string[]; sessions: Record<string, string[]> };

const KEY = 'somecode.sidebarOrder';
const EMPTY: SidebarOrder = { projects: [], sessions: {} };

export function loadOrder(): SidebarOrder {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as Partial<SidebarOrder> | null;
    if (!raw || !Array.isArray(raw.projects) || typeof raw.sessions !== 'object' || raw.sessions === null) return EMPTY;
    return { projects: raw.projects.filter((v) => typeof v === 'string'), sessions: raw.sessions as Record<string, string[]> };
  } catch {
    return EMPTY;
  }
}

export function saveOrder(order: SidebarOrder): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(order));
  } catch {
    // The order then only lasts for this page load.
  }
}

/** The items in the saved order; ones the saved order does not know (new ones) stay first, in their own order. */
export function applyOrder<T extends { id: string }>(items: readonly T[], saved: readonly string[] | undefined): T[] {
  if (!saved || saved.length === 0) return [...items];
  const rank = new Map(saved.map((id, i) => [id, i]));
  const fresh = items.filter((i) => !rank.has(i.id));
  const known = items.filter((i) => rank.has(i.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...fresh, ...known];
}

/** `ids` with `id` moved next to `target` (before it, or after it when `after`). */
export function moveNextTo(ids: readonly string[], id: string, target: string, after: boolean): string[] {
  if (id === target) return [...ids];
  const rest = ids.filter((v) => v !== id);
  const at = rest.indexOf(target);
  if (at === -1) return [...ids];
  rest.splice(after ? at + 1 : at, 0, id);
  return rest;
}
