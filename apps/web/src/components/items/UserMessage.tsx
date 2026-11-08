import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ImageAttachment } from "@somecode/protocol";
import { t } from "../../i18n/index.ts";
import { useCopy } from "../../hooks/useCopy.ts";
import { formatBytes, splitAttachedFiles } from "../../lib/attachedFiles.ts";
import { FileIcon } from "../FileIcon.tsx";
import { SymbolIcon } from "../SymbolIcon.tsx";

/**
 * The user's prompt: a rounded bubble on the right, plain text. A copy action sits under it and shows on hover
 * or keyboard focus. `local` (not yet confirmed by the server) is shown slightly dimmer.
 */
export function UserMessage({
  text,
  images,
  local = false,
}: {
  text: string;
  images?: ImageAttachment[];
  local?: boolean;
}) {
  const { copied, copy } = useCopy(text);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const { body, files } = splitAttachedFiles(text);
  const isGoal = body.startsWith("/goal");
  const displayText = isGoal ? body.slice(5).trim() : body;

  useEffect(() => {
    if (!activeImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setActiveImage(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeImage]);

  return (
    <div className="group flex flex-col items-end">
      {images && images.length > 0 && (
        <div className="mb-2 flex flex-wrap justify-end gap-2 max-w-[85%]">
          {images.map((img, i) => {
            const src = img.data.startsWith("data:") ? img.data : `data:${img.mimeType};base64,${img.data}`;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveImage(src)}
                className="overflow-hidden rounded-xl border border-border/50 bg-bg-elevated p-1 shadow-sm transition hover:scale-[1.02] hover:border-border"
                title={img.name || "Görsel"}
              >
                <img
                  src={src}
                  alt={img.name || "Attachment"}
                  className="max-h-48 max-w-[280px] rounded-lg object-contain bg-black/20"
                />
              </button>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex max-w-[85%] flex-wrap justify-end gap-2">
          {files.map((f, i) => (
            <span key={`${f.name}:${i}`} className="file-chip" title={f.name}>
              <FileIcon path={f.name} className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="text-text-muted">{formatBytes(f.bytes)}</span>
            </span>
          ))}
        </div>
      )}
      {(displayText || (!images || images.length === 0) && files.length === 0) && (
        <div
          className={`user-bubble max-w-[85%] min-w-0 font-ui text-[14.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${
            local ? "text-text-muted" : "text-text"
          } ${isGoal ? "border border-amber-500/40 bg-amber-500/10" : ""}`}
        >
          <span className="sr-only">{t("item.user")}: </span>
          {isGoal && (
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-amber-400 text-xs tracking-wide">
              <SymbolIcon name="goal" className="size-3.5" />
              <span>/goal</span>
            </div>
          )}
          {displayText || body || text}
        </div>
      )}
      <div className="msg-actions mt-1 mr-1 flex h-6 items-center gap-1 text-text-muted">
        <button
          type="button"
          onClick={copy}
          aria-label={t("message.copy")}
          title={t("message.copy")}
          className="msg-action"
        >
          <SymbolIcon name="copy" className="size-3.5" />
          {copied && <span aria-live="polite" className="text-xs">{t("copy.done")}</span>}
        </button>
      </div>

      {activeImage &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-in fade-in duration-150 select-none"
            onClick={() => setActiveImage(null)}
          >
            <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
              <span className="text-[11px] font-mono text-white/50 tracking-wider">ESC</span>
              <button
                type="button"
                onClick={() => setActiveImage(null)}
                aria-label={t("error.dismiss")}
                className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                <SymbolIcon name="close" className="size-4" />
              </button>
            </div>
            <div
              className="relative flex max-h-[88vh] max-w-[92vw] items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={activeImage}
                alt="Enlarged view"
                className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl ring-1 ring-white/10"
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
