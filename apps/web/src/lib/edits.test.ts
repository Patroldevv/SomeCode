import { describe, expect, it } from 'vitest';
import { editsOfLastTurn } from './edits.ts';
import type { Item } from './sessionState.ts';

const tool = (key: string, path: string, oldText: string | null, newText: string): Item =>
  ({ key, kind: 'tool', toolCallId: key, title: key, toolKind: 'edit', status: 'completed', content: [{ type: 'diff', path, oldText, newText }] }) as unknown as Item;
const user = (key: string): Item => ({ key, kind: 'user', text: 'hi' }) as unknown as Item;

describe('editsOfLastTurn', () => {
  it('merges edits of one path and counts lines', () => {
    const files = editsOfLastTurn([user('u'), tool('t1', 'a.ts', 'x\n', 'x\ny\n'), tool('t2', 'a.ts', 'y\n', 'z\n'), tool('t3', 'b.ts', null, 'n\n')]);
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(files[0]).toMatchObject({ toolKeys: ['t1', 't2'] });
    expect(files[1]).toMatchObject({ added: 1, removed: 0 });
  });

  it('only looks at the turn after the last user message', () => {
    expect(editsOfLastTurn([tool('t0', 'old.ts', null, 'a\n'), user('u'), tool('t1', 'new.ts', null, 'a\n')]).map((f) => f.path)).toEqual(['new.ts']);
  });

  it('is empty when nothing changed', () => {
    expect(editsOfLastTurn([user('u')])).toEqual([]);
    expect(editsOfLastTurn([])).toEqual([]);
  });
});

describe('editsOfSession', () => {
  it('covers every turn and keeps each change for previews', async () => {
    const { editsOfSession, totalStats } = await import('./edits.ts');
    const files = editsOfSession([tool('t0', 'old.ts', null, 'a\n'), user('u'), tool('t1', 'new.ts', null, 'a\nb\n'), tool('t2', 'new.ts', 'a\n', 'c\n')]);
    expect(files.map((f) => f.path)).toEqual(['old.ts', 'new.ts']);
    expect(files[1]!.changes).toHaveLength(2);
    expect(totalStats(files)).toEqual({ added: files[0]!.added + files[1]!.added, removed: files[0]!.removed + files[1]!.removed });
  });
});

describe('edits from raw input and failed tools', () => {
  it('counts a write described only by its input, and skips failed calls', () => {
    const write = { key: 'w', kind: 'tool', id: 'w', title: 'write', toolKind: 'edit', status: 'completed', content: [], rawInput: { filePath: 'n.ts', content: 'a\nb\n' } } as unknown as Item;
    const failed = { ...write, key: 'f', status: 'failed', rawInput: { filePath: 'bad.ts', content: 'x\n' } } as unknown as Item;
    const files = editsOfLastTurn([user('u'), write, failed]);
    expect(files.map((f) => f.path)).toEqual(['n.ts']);
    expect(files[0]).toMatchObject({ added: 2, removed: 0 });
  });
});

describe('withEditsRows', () => {
  it('keeps a summary after every finished turn, and waits for the running one to finish', async () => {
    const { withEditsRows } = await import('./edits.ts');
    const items = [user('u1'), tool('t1', 'a.ts', null, 'a\n'), user('u2'), tool('t2', 'b.ts', null, 'b\n')];
    const settled = withEditsRows(items, false);
    expect(settled.map((r) => r.key)).toEqual(['u1', 't1', 'edits:u1', 'u2', 't2', 'edits:u2']);
    const running = withEditsRows(items, true);
    expect(running.map((r) => r.key)).toEqual(['u1', 't1', 'edits:u1', 'u2', 't2']);
    const first = settled[2];
    expect(first && first.kind === 'edits' && first.files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('adds nothing for turns without edits', async () => {
    const { withEditsRows } = await import('./edits.ts');
    expect(withEditsRows([user('u1'), user('u2')], false).map((r) => r.kind)).toEqual(['user', 'user']);
  });
});
