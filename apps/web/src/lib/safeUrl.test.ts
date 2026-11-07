import { describe, expect, it } from 'vitest';
import { safeHref } from './safeUrl.ts';

describe('safeHref', () => {
  it.each(['https://a.b', 'http://a.b/x?y=1#z', 'HTTPS://A.B', 'mailto:x@y.z', '#user-content-fn-1', '#user-content-fnref-1-2'])('allows %j unchanged', (url) => {
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:1',
    ' javascript:1',
    'java\tscript:1',
    'java\nscript:1',
    '\u0000javascript:1',
    'javascript\u0000:1',
    '​javascript:1',
    'data:text/html,x',
    'vbscript:x',
    'file:///etc/passwd',
    '%6Aavascript:1',
    'jаvascript:1', // Cyrillic "а"
    'ｊavascript:1', // fullwidth "ｊ"
    'blob:https://a.b/1',
    'ftp://a.b',
    'http:foo',
    'https:/a.b',
    ' https://a.b',
    'https://a.b\n',
    '/x',
    'foo',
    './foo',
    '//evil.example',
    '',
    // Fragments other than the renderer's own anchors: they could address the app (`#token=` on reload).
    '#token=x',
    '#bolum',
    '#',
    '#user-content-',
    '#user-content-fn-1&token=x',
    '#user-content-x#token=y',
  ])('rejects %j', (url) => {
    expect(safeHref(url)).toBeNull();
  });
});
