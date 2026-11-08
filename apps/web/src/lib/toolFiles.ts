import { diffStats } from './diffView.ts';
import type { ToolItem } from './sessionState.ts';

export type FileChange = { oldText: string | null; newText: string };
export type ToolFile = { path: string; added: number; removed: number; changes: FileChange[] };

const PATH_KEYS = ['filePath', 'file_path', 'path', 'file', 'filename'];
const NEW_KEYS = ['content', 'newString', 'new_string', 'newText', 'new_text', 'text'];
const OLD_KEYS = ['oldString', 'old_string', 'oldText', 'old_text'];

const pick = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The files a tool call changed. Agents that send diff blocks are read from those; for the others an edit tool's
 * raw input is read (`filePath` + `content` for a write, `oldString`/`newString` pairs for edits). Anything that
 * is not an edit, or has no readable path, yields nothing.
 */
export function toolFiles(item: ToolItem): ToolFile[] {
  const files = new Map<string, ToolFile>();
  const add = (path: string, oldText: string | null, newText: string) => {
    const stats = diffStats(oldText, newText);
    const file = files.get(path) ?? { path, added: 0, removed: 0, changes: [] };
    file.added += stats.added;
    file.removed += stats.removed;
    file.changes.push({ oldText, newText });
    files.set(path, file);
  };
  for (const block of item.content) {
    if (block.type === 'diff') add(block.path, block.oldText, block.newText);
  }
  if (files.size > 0 || item.toolKind !== 'edit' || !isRecord(item.rawInput)) return [...files.values()];

  const input = item.rawInput;
  const path = pick(input, PATH_KEYS);
  if (!path) return [];
  if (Array.isArray(input['edits'])) {
    for (const edit of input['edits']) {
      if (!isRecord(edit)) continue;
      const next = pick(edit, NEW_KEYS);
      if (next !== undefined) add(path, pick(edit, OLD_KEYS) ?? null, next);
    }
    return [...files.values()];
  }
  const next = pick(input, NEW_KEYS);
  if (next !== undefined) add(path, pick(input, OLD_KEYS) ?? null, next);
  return [...files.values()];
}

/** The sum of added and removed lines over the files. */
export function sumStats(files: readonly ToolFile[]): { added: number; removed: number } {
  return files.reduce((s, f) => ({ added: s.added + f.added, removed: s.removed + f.removed }), { added: 0, removed: 0 });
}
