import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { tr } from './tr.ts';
import { errorText, interpolate, plural, setLanguageForTests, t, type MessageKey } from './index.ts';

const placeholders = (message: string): string[] =>
  [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))].sort();

afterEach(() => setLanguageForTests(null));

describe('t()', () => {
  it('returns Turkish when the language is Turkish', () => {
    setLanguageForTests('tr-TR');
    expect(t('chat.send')).toBe('Gönder');
  });

  it('returns English when the language is English', () => {
    setLanguageForTests('en');
    expect(t('chat.send')).toBe('Send');
  });

  it('falls back to English for other languages', () => {
    setLanguageForTests('de-DE');
    expect(t('chat.send')).toBe('Send');
  });

  it('restores the detected navigator language when reset with null', () => {
    setLanguageForTests('tr');
    setLanguageForTests(null);
    expect(t('chat.send')).toBe(globalThis.navigator?.language?.toLowerCase().startsWith('tr') ? 'Gönder' : 'Send');
  });

  it('accepts params and leaves messages without placeholders unchanged', () => {
    setLanguageForTests('en');
    expect(t('chat.send', { n: 6 })).toBe('Send');
  });

  it('keeps errorText working in both languages', () => {
    setLanguageForTests('en');
    expect(errorText('network')).toBe(en['error.network']);
    expect(errorText('no-such-code')).toBe(en['error.internal']);
    setLanguageForTests('tr');
    expect(errorText('network')).toBe(tr['error.network']);
  });
});

describe('plural()', () => {
  it('picks the CLDR plural form in English', () => {
    setLanguageForTests('en');
    expect(plural('diff.added', 0)).toBe('0 lines added');
    expect(plural('diff.added', 1)).toBe('1 line added');
    expect(plural('diff.added', 2)).toBe('2 lines added');
    expect(plural('diff.removed', 1)).toBe('1 line removed');
    expect(t('diff.stats', { added: plural('diff.added', 1), removed: plural('diff.removed', 3) })).toBe(
      '1 line added, 3 lines removed',
    );
  });

  it('Turkish keeps one form', () => {
    setLanguageForTests('tr');
    expect(plural('diff.added', 1)).toBe('1 satır eklendi');
    expect(plural('diff.added', 5)).toBe('5 satır eklendi');
    expect(plural('diff.removed', 1)).toBe('1 satır silindi');
  });

  it('every plural family has an `.other` form in both languages', () => {
    for (const key of Object.keys(en)) {
      const one = /^(.*)\.one$/.exec(key);
      if (one) expect(Object.keys(tr)).toContain(`${one[1]}.other`);
    }
  });
});

describe('interpolate()', () => {
  it('fills {name} placeholders with strings and numbers', () => {
    expect(interpolate('{n} steps by {who}', { n: 6, who: 'agent' })).toBe('6 steps by agent');
  });

  it('fills every occurrence of a repeated placeholder', () => {
    expect(interpolate('{n} of {n}', { n: 2 })).toBe('2 of 2');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('{n} and {missing}', { n: 1 })).toBe('1 and {missing}');
    expect(interpolate('{n}')).toBe('{n}');
  });

  it('does not re-interpolate substituted values', () => {
    expect(interpolate('{a} {b}', { a: '{b}', b: 'x' })).toBe('{b} x');
  });
});

describe('message tables', () => {
  it('has the same keys in en and tr', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses the same set of {param} placeholders in every key of both languages', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(placeholders(tr[key]), `placeholders of ${key}`).toEqual(placeholders(en[key]));
    }
  });

  it('detects a placeholder mismatch', () => {
    expect(placeholders('{b} and {a} and {a}')).toEqual(['a', 'b']);
    expect(placeholders('none')).toEqual([]);
  });
});
