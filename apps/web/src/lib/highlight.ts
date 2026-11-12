// Code highlighting with Shiki's core build and its JavaScript regex engine (no WASM). The highlighter is a
// lazily created singleton. Shiki itself, the engine, every grammar and both themes are loaded on demand
// through dynamic `import()`, so each lands in its own chunk and the main bundle carries none of them.
import type { HighlighterCore, LanguageInput, ThemeInput } from 'shiki/core';
import { getClientSettings } from './settings.ts';
import { shikiThemeFor } from './shikiThemes.ts';

/** One rendered line: consecutive tokens whose texts join back to the source line. */
export type HighlightedLine = { text: string; color?: string }[];

type Loader = () => LanguageInput;

const typescript: Loader = () => import('shiki/langs/typescript.mjs');
const javascript: Loader = () => import('shiki/langs/javascript.mjs');
const shell: Loader = () => import('shiki/langs/shellscript.mjs');

/** Fence label (lower-cased) → [Shiki language id, grammar loader]. A Map, so `__proto__`/`constructor` never match. */
const LANGUAGES = new Map<string, readonly [string, Loader]>();
function register(id: string, load: Loader, ...labels: string[]): void {
  for (const label of [id, ...labels]) LANGUAGES.set(label, [id, load]);
}
register('typescript', typescript, 'ts', 'mts', 'cts');
register('tsx', () => import('shiki/langs/tsx.mjs'));
register('javascript', javascript, 'js', 'mjs', 'cjs');
register('jsx', () => import('shiki/langs/jsx.mjs'));
register('json', () => import('shiki/langs/json.mjs'));
register('shellscript', shell, 'bash', 'sh', 'shell', 'zsh', 'console');
register('python', () => import('shiki/langs/python.mjs'), 'py');
register('rust', () => import('shiki/langs/rust.mjs'), 'rs');
register('go', () => import('shiki/langs/go.mjs'), 'golang');
register('css', () => import('shiki/langs/css.mjs'));
register('html', () => import('shiki/langs/html.mjs'), 'htm');
register('markdown', () => import('shiki/langs/markdown.mjs'), 'md');
register('yaml', () => import('shiki/langs/yaml.mjs'), 'yml');
register('diff', () => import('shiki/langs/diff.mjs'), 'patch');
register('sql', () => import('shiki/langs/sql.mjs'));
register('c', () => import('shiki/langs/c.mjs'), 'h');
register('cpp', () => import('shiki/langs/cpp.mjs'), 'c++', 'cc', 'cxx', 'hpp');
register('java', () => import('shiki/langs/java.mjs'));
register('toml', () => import('shiki/langs/toml.mjs'));


/** Blocks larger than this stay plain: tokenising runs on the main thread. */
const MAX_CODE_LENGTH = 100_000;
/** Longer lines come back as one uncoloured token (Shiki's own limit), so minified code cannot stall the UI. */
const MAX_LINE_LENGTH = 5_000;

let highlighter: Promise<HighlighterCore> | null = null;
const loads = new Map<string, Promise<void>>();

async function createHighlighter(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ]);
  return createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) });
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighter().catch((error: unknown) => {
    highlighter = null; // let a later call retry
    throw error;
  });
  return highlighter;
}

/** Runs `load` once per key; a failed load is forgotten so it can be retried. */
function once(key: string, load: () => Promise<void>): Promise<void> {
  let pending = loads.get(key);
  if (!pending) {
    pending = load().catch((error: unknown) => {
      loads.delete(key);
      throw error;
    });
    loads.set(key, pending);
  }
  return pending;
}

/** The theme for the page's light or dark mode, as chosen in the settings. */
function currentTheme(): [name: string, load: () => ThemeInput] {
  const light = typeof document !== 'undefined' && document.documentElement.dataset['theme'] === 'light';
  const { codeThemeLight, codeThemeDark } = getClientSettings();
  return shikiThemeFor(light ? codeThemeLight : codeThemeDark, light);
}

/**
 * Highlights `code` as `lang` with the theme that matches the page right now (`data-theme`).
 * Resolves `null` — never rejects — for an unknown language, oversized input or any load/tokenise failure,
 * in which case the caller shows plain text.
 */
export async function highlightTokens(code: string, lang: string | undefined): Promise<HighlightedLine[] | null> {
  const language = lang ? LANGUAGES.get(lang.trim().toLowerCase()) : undefined;
  if (!language || code.length > MAX_CODE_LENGTH) return null;
  const [langId, loadLang] = language;
  const [themeId, loadTheme] = currentTheme();
  try {
    const shiki = await getHighlighter();
    await Promise.all([
      once(`lang:${langId}`, () => shiki.loadLanguage(loadLang())),
      once(`theme:${themeId}`, () => shiki.loadTheme(loadTheme())),
    ]);
    const lines = shiki.codeToTokensBase(code, { lang: langId, theme: themeId, tokenizeMaxLineLength: MAX_LINE_LENGTH });
    return lines.map((line) => line.map(({ content, color }) => (color ? { text: content, color } : { text: content })));
  } catch {
    return null;
  }
}
