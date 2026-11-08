import { describe, expect, it } from 'vitest';
import type { ToolItem } from './sessionState.ts';
import { sumStats, toolFiles } from './toolFiles.ts';

const tool = (over: Partial<ToolItem>): ToolItem => ({ kind: 'tool', key: 'k', id: 'i', title: 'write', toolKind: 'edit', status: 'completed', content: [], ...over });

describe('toolFiles', () => {
  it('reads diff blocks first', () => {
    const files = toolFiles(tool({ content: [{ type: 'diff', path: 'a.ts', oldText: 'x\n', newText: 'x\ny\n' }] }));
    expect(files).toMatchObject([{ path: 'a.ts', added: 1, removed: 0 }]);
  });

  it('reads a write from its raw input (lines created)', () => {
    const files = toolFiles(tool({ rawInput: { filePath: '/p/new.ts', content: 'a\nb\nc\n' } }));
    expect(files).toMatchObject([{ path: '/p/new.ts', added: 3, removed: 0 }]);
    expect(files[0]!.changes[0]!.oldText).toBeNull();
  });

  it('reads old/new string edits, including a list of edits', () => {
    expect(toolFiles(tool({ rawInput: { file_path: 'a.ts', old_string: 'a\n', new_string: 'b\nc\n' } }))).toMatchObject([{ added: 2, removed: 1 }]);
    const multi = toolFiles(tool({ rawInput: { path: 'a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] } }));
    expect(multi[0]!.changes).toHaveLength(2);
  });

  it('ignores tools that are not edits or have no readable path', () => {
    expect(toolFiles(tool({ toolKind: 'execute', rawInput: { filePath: 'a', content: 'x' } }))).toEqual([]);
    expect(toolFiles(tool({ rawInput: { content: 'x' } }))).toEqual([]);
    expect(toolFiles(tool({ rawInput: 'text' }))).toEqual([]);
  });

  it('sums counts', () => {
    expect(sumStats([{ path: 'a', added: 2, removed: 1, changes: [] }, { path: 'b', added: 3, removed: 4, changes: [] }])).toEqual({ added: 5, removed: 5 });
  });
});
