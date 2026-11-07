import { describe, expect, it } from 'vitest';
import { splitMarkdownBlocks } from './markdownBlocks.ts';

const split = (text: string): string[] => {
  const blocks = splitMarkdownBlocks(text);
  // The invariant for every case: blocks keep their separators, so they concatenate back to the input.
  expect(blocks.join('')).toBe(text);
  return blocks;
};

describe('splitMarkdownBlocks', () => {
  it('splits paragraphs on blank lines, keeping the separators on the earlier block', () => {
    expect(split('one\n\ntwo\n\n\nthree')).toEqual(['one\n\n', 'two\n\n\n', 'three']);
  });

  it('empty and blank-only texts are one block', () => {
    expect(split('')).toEqual(['']);
    expect(split('\n\n  \n')).toEqual(['\n\n  \n']);
  });

  it('leading and trailing blank lines stay with the first and last block', () => {
    expect(split('\n\npara\n\nnext\n\n')).toEqual(['\n\npara\n\n', 'next\n\n']);
  });

  it('a fence with blank lines inside stays whole', () => {
    const text = 'intro\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\nafter';
    expect(split(text)).toEqual(['intro\n\n', '```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\n', 'after']);
  });

  it('tilde fences and longer closing fences follow CommonMark', () => {
    expect(split('~~~\na\n\n```\nb\n~~~~\n\nc')).toEqual(['~~~\na\n\n```\nb\n~~~~\n\n', 'c']);
    // A shorter run does not close a longer fence.
    expect(split('````\na\n```\n\nb\n````\n\nc')).toEqual(['````\na\n```\n\nb\n````\n\n', 'c']);
  });

  it('an unterminated fence at the end stays one block', () => {
    expect(split('para\n\n```py\nx = 1\n\ny = 2\n\n')).toEqual(['para\n\n', '```py\nx = 1\n\ny = 2\n\n']);
  });

  it('a backtick line with a backtick in its info string is inline code, not a fence', () => {
    expect(split('``` a ` b\n\nnext')).toEqual(['``` a ` b\n\n', 'next']);
  });

  it('tables and tight lists are never split (they contain no blank line)', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n';
    const list = '- one\n- two\n  - nested\n- three\n';
    expect(split(`${table}\n${list}\nend`)).toEqual([`${table}\n`, `${list}\n`, 'end']);
  });

  it('an indented line after a blank line continues the block (list item paragraphs, indented code)', () => {
    const list = '- item\n\n  more of the item\n\n- next item\n';
    expect(split(list)).toEqual(['- item\n\n  more of the item\n\n', '- next item\n']);
    expect(split('    code\n\n    more code\n\npara')).toEqual(['    code\n\n    more code\n\n', 'para']);
  });

  it('a reference or footnote definition anywhere keeps the whole text in one block', () => {
    const ref = 'see [docs][d]\n\nmore\n\n[d]: https://example.com';
    expect(split(ref)).toEqual([ref]);
    const footnote = 'claim[^1]\n\nmore\n\n[^1]: the source';
    expect(split(footnote)).toEqual([footnote]);
    const quoted = 'a [x]\n\n> [x]: https://example.com';
    expect(split(quoted)).toEqual([quoted]);
  });

  it('handles CRLF line endings', () => {
    expect(split('one\r\n\r\ntwo')).toEqual(['one\r\n\r\n', 'two']);
  });

  it('is prefix-stable: while streaming, every completed block keeps its exact text', () => {
    const full = '# Title\n\nFirst paragraph.\n\n```js\nlet a;\n\nlet b;\n```\n\n| h |\n| - |\n| c |\n\n- x\n- y\n\nThe end.';
    let previous: string[] = [];
    for (let end = 1; end <= full.length; end++) {
      const blocks = split(full.slice(0, end));
      // All blocks but the last of the previous prefix are unchanged.
      for (let i = 0; i < previous.length - 1; i++) expect(blocks[i]).toBe(previous[i]);
      previous = blocks;
    }
    expect(previous).toHaveLength(6);
  });
});
