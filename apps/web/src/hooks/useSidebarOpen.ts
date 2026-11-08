import { useCallback, useEffect, useState } from "react";
import { matchesShortcut } from "../lib/shortcuts.ts";
import { loadSidebarOpen, saveSidebarOpen } from "../lib/sidebarPrefs.ts";

/**
 * The sidebar's open state, remembered across page loads and toggled by Ctrl+B (Command+B on macOS). The
 * shortcut is ignored while a modal dialog is open (the sidebar is behind it) and during IME composition.
 */
export function useSidebarOpen(): [open: boolean, toggle: () => void, setOpen: (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      if (
        localStorage.getItem("somecode.sidebarOpen") === null &&
        window.innerWidth <= 760
      )
        return false;
    } catch {}
    return loadSidebarOpen();
  });
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    saveSidebarOpen(open);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || !matchesShortcut(e, "ctrl+b")) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return [open, toggle, setOpen];
}
