import type { Item } from './sessionState.ts';
import { toolFiles } from './toolFiles.ts';

export type EditedFile = {
  path: string;
  added: number;
  removed: number;
  toolKeys: string[];
  /** Every change the agent made to the file, in order (for previews). */
  changes: { oldText: string | null; newText: string }[];
};

/** The files the given items changed, merged by path with their `+added -removed` counts, in first-touched order. */
function collect(items: readonly Item[], start: number, end = items.length): EditedFile[] {
  const files = new Map<string, EditedFile>();
  for (let i = start; i < end; i++) {
    const item = items[i]!;
    if (item.kind !== 'tool' || item.status === 'failed') continue;
    for (const edit of toolFiles(item)) {
      const file = files.get(edit.path) ?? { path: edit.path, added: 0, removed: 0, toolKeys: [], changes: [] };
      file.added += edit.added;
      file.removed += edit.removed;
      file.changes.push(...edit.changes);
      if (!file.toolKeys.includes(item.key)) file.toolKeys.push(item.key);
      files.set(edit.path, file);
    }
  }
  return [...files.values()];
}

/** The files changed since the user's last message (the current turn). Empty while the turn changed nothing. */
export function editsOfLastTurn(items: readonly Item[]): EditedFile[] {
  let start = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.kind === 'user') {
      start = i + 1;
      break;
    }
  }
  return collect(items, start);
}

/** Every file the agent changed in the session. */
export function editsOfSession(items: readonly Item[]): EditedFile[] {
  return collect(items, 0);
}

export function totalStats(files: readonly EditedFile[]): { added: number; removed: number } {
  return files.reduce((sum, f) => ({ added: sum.added + f.added, removed: sum.removed + f.removed }), { added: 0, removed: 0 });
}

/** A summary of the files one turn changed, shown in the conversation right after that turn. */
export type EditsRow = { kind: 'edits'; key: string; files: EditedFile[] };

/**
 * The conversation with a summary of changed files after every finished turn that changed something. A turn runs
 * from a user message to the next one; the turn still in progress gets its summary only once it is over, so each
 * summary stays where it belongs when the next message is written.
 */
export function withEditsRows(items: readonly Item[], running: boolean): (Item | EditsRow)[] {
  const rows: (Item | EditsRow)[] = [];
  let start = 0;
  let turnKey = 'start';
  const close = (end: number, last: boolean) => {
    if (last && running) return;
    const files = collect(items, start, end);
    if (files.length > 0) rows.push({ kind: 'edits', key: `edits:${turnKey}`, files });
  };
  items.forEach((item, i) => {
    if (item.kind === 'user' && i > start) {
      close(i, false);
      start = i;
    }
    if (item.kind === 'user') turnKey = item.key;
    rows.push(item);
  });
  close(items.length, true);
  return rows;
}
