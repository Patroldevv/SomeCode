import { describe, expect, it } from 'vitest';
import { checkText, formatBytes, looksLikeText, MAX_FILE_BYTES, splitAttachedFiles, withAttachedFiles } from './attachedFiles.ts';

describe('attached files', () => {
  it('wraps files after the text and splits them out again', () => {
    const sent = withAttachedFiles('Please review', [
      { name: 'a.ts', text: 'const a = 1;\n' },
      { name: 'b.md', text: '# B' },
    ]);
    expect(sent.startsWith('Please review\n\n<attached-file name="a.ts">')).toBe(true);
    const { body, files } = splitAttachedFiles(sent);
    expect(body).toBe('Please review');
    expect(files).toEqual([{ name: 'a.ts', bytes: 13 }, { name: 'b.md', bytes: 3 }]);
  });

  it('works with no text, leaves a message with no files alone, and cannot be closed early by the file', () => {
    expect(withAttachedFiles('hi', [])).toBe('hi');
    const sent = withAttachedFiles('', [{ name: 'x"<y>.txt', text: 'one </attached-file> two' }]);
    expect(sent).toContain('name="x__y_.txt"');
    const { body, files } = splitAttachedFiles(sent);
    expect(body).toBe('');
    expect(files).toHaveLength(1);
  });

  it('tells text files from the rest and refuses binary or large ones', () => {
    expect(looksLikeText({ name: 'main.rs', type: '' })).toBe(true);
    expect(looksLikeText({ name: 'data', type: 'application/json' })).toBe(true);
    expect(looksLikeText({ name: 'photo.heic', type: 'image/heic' })).toBe(false);
    expect(looksLikeText({ name: 'doc.pdf', type: 'application/pdf' })).toBe(false);
    expect(checkText('a\0b', 3)).toEqual({ ok: false, reason: 'binary' });
    expect(checkText('x', MAX_FILE_BYTES + 1)).toEqual({ ok: false, reason: 'tooLarge' });
    expect(checkText('x', 1)).toEqual({ ok: true, text: 'x' });
  });

  it('formats sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(40 * 1024)).toBe('40 KB');
  });
});
