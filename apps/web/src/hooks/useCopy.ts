import { useEffect, useState } from "react";

/** Copies text to the clipboard and reports `copied` for a moment; a failing clipboard is silently ignored. */
export function useCopy(text: string): { copied: boolean; copy: () => Promise<void> } {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard unavailable or denied.
    }
  };
  return { copied, copy };
}
