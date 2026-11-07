import { useCallback, useEffect, useState } from 'react';
import { matchesShortcut } from '../lib/shortcuts.ts';
import { loadSidebarOpen, saveSidebarOpen } from '../lib/sidebarPrefs.ts';

/** The sidebar's open state, remembered across page loads and toggled by Ctrl+B (Command+B on macOS). */
export function useSidebarOpen(): [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(loadSidebarOpen);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    saveSidebarOpen(open);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !matchesShortcut(e, 'ctrl+b')) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return [open, toggle];
}
