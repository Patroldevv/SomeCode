import type { ThemeInput } from 'shiki/core';
import { findTheme, type ThemeDef } from './codeTheme.ts';

/** The picker's themes that Shiki ships under its own name. */
const BUNDLED: Record<string, [name: string, load: () => ThemeInput]> = {
  'github-light': ['github-light', () => import('shiki/themes/github-light.mjs')],
  'github-light-default': ['github-light-default', () => import('shiki/themes/github-light-default.mjs')],
  'vscode-light': ['light-plus', () => import('shiki/themes/light-plus.mjs')],
  'one-light': ['one-light', () => import('shiki/themes/one-light.mjs')],
  'catppuccin-latte': ['catppuccin-latte', () => import('shiki/themes/catppuccin-latte.mjs')],
  'github-dark': ['github-dark', () => import('shiki/themes/github-dark.mjs')],
  'github-dark-dimmed': ['github-dark-dimmed', () => import('shiki/themes/github-dark-dimmed.mjs')],
  'github-dark-high-contrast': ['github-dark-high-contrast', () => import('shiki/themes/github-dark-high-contrast.mjs')],
  'vscode-dark': ['dark-plus', () => import('shiki/themes/dark-plus.mjs')],
  'one-dark-pro': ['one-dark-pro', () => import('shiki/themes/one-dark-pro.mjs')],
  dracula: ['dracula', () => import('shiki/themes/dracula.mjs')],
  'dracula-soft': ['dracula-soft', () => import('shiki/themes/dracula-soft.mjs')],
  'catppuccin-mocha': ['catppuccin-mocha', () => import('shiki/themes/catppuccin-mocha.mjs')],
};

/** A Shiki theme made from the palette of a picker theme that Shiki does not ship (Claude's, Pierre's). */
export function themeFromPalette(def: ThemeDef): ThemeInput {
  return {
    name: def.id,
    type: def.isDark ? 'dark' : 'light',
    fg: def.fg,
    bg: def.bg,
    settings: [
      { settings: { foreground: def.fg, background: def.bg } },
      { scope: ['keyword', 'storage', 'keyword.control', 'storage.type'], settings: { foreground: def.keyword } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: def.fn } },
      { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: def.type } },
      { scope: ['variable.parameter', 'meta.parameters variable'], settings: { foreground: def.param } },
      { scope: ['string', 'string.quoted'], settings: { foreground: def.string } },
      { scope: ['constant.numeric', 'constant.language'], settings: { foreground: def.type } },
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: def.lineNum, fontStyle: 'italic' } },
    ],
  } as ThemeInput;
}

/** The Shiki name and loader for the theme chosen for the light or the dark page. */
export function shikiThemeFor(id: string, light: boolean): [name: string, load: () => ThemeInput] {
  const bundled = BUNDLED[id];
  if (bundled) return bundled;
  const def = findTheme(id, light);
  return [def.id, () => themeFromPalette(def)];
}
