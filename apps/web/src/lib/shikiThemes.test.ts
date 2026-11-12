import { describe, expect, it } from 'vitest';
import { DARK_THEMES, LIGHT_THEMES } from './codeTheme.ts';
import { shikiThemeFor } from './shikiThemes.ts';

describe('shikiThemeFor', () => {
  it('loads every theme the picker offers, bundled or made from its palette', async () => {
    const promises: Promise<void>[] = [];
    for (const [list, light] of [[LIGHT_THEMES, true], [DARK_THEMES, false]] as const) {
      for (const def of list) {
        const [name, load] = shikiThemeFor(def.id, light);
        promises.push(
          Promise.resolve(load()).then((theme: any) => {
            expect(name).toBeTruthy();
            expect(theme.name ?? theme.default?.name).toBeTruthy();
          })
        );
      }
    }
    await Promise.all(promises);
  }, 15_000);

  it('uses the palette for Claude\'s own themes and falls back to the first theme for an unknown id', async () => {
    const [name, load] = shikiThemeFor('claude-dark', false);
    expect(name).toBe('claude-dark');
    expect(await load()).toMatchObject({ type: 'dark', bg: expect.any(String) });
    expect(shikiThemeFor('nope', true)[0]).toBe('claude-light');
  });
});
