export type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/**
 * Whether a key event is the shortcut `combo` (`'ctrl+b'`, `'ctrl+shift+b'`, `'escape'`; case-insensitive).
 * `ctrl` also accepts Meta, so the same combo is Ctrl+B on Linux/Windows and Command+B on macOS. Every
 * modifier must match exactly: Ctrl+Shift+B is not `ctrl+b`.
 */
export function matchesShortcut(e: ShortcutEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  return (
    e.key.toLowerCase() === key &&
    (e.ctrlKey || e.metaKey) === mods.has('ctrl') &&
    e.shiftKey === mods.has('shift') &&
    e.altKey === mods.has('alt')
  );
}
