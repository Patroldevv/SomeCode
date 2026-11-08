import { t } from "../../i18n/index.ts";
import { useCopy } from "../../hooks/useCopy.ts";
import { Markdown } from "../Markdown.tsx";
import { SymbolIcon } from "../SymbolIcon.tsx";

/**
 * The agent's reply: plain text on the page (no bubble), rendered as safe markdown. A copy action (raw markdown)
 * appears under it on hover or keyboard focus.
 */
export function AgentMessage({ text }: { text: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <div className="group min-w-0 font-voice text-[14.5px] leading-[1.7] text-text">
      <Markdown text={text} />
      <div className="msg-actions mt-1 flex h-6 items-center gap-1 font-ui text-xs text-text-muted">
        <button type="button" onClick={copy} aria-label={t("message.copy")} title={t("message.copy")} className="msg-action">
          <SymbolIcon name="copy" className="size-3.5" />
          {copied && <span aria-live="polite">{t("copy.done")}</span>}
        </button>
      </div>
    </div>
  );
}
