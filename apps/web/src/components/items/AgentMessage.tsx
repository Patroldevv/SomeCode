import { t } from "../../i18n/index.ts";
import { useCopy } from "../../hooks/useCopy.ts";
import { Markdown } from "../Markdown.tsx";
import { SymbolIcon } from "../SymbolIcon.tsx";
import { useResearchControl } from "./ResearchContext.tsx";

/** A long answer in a research chat is a report: it can be saved as a Markdown file. */
const REPORT_MIN_CHARS = 900;

function reportName(text: string): string {
  const heading = /^#{1,3}\s+(.+)$/m.exec(text)?.[1] ?? "report";
  const slug = heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "report"}.md`;
}

function download(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = reportName(text);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The agent's reply: plain text on the page (no bubble), rendered as safe markdown. A copy action (raw markdown)
 * appears under it on hover or keyboard focus.
 */
export function AgentMessage({ text }: { text: string }) {
  const { copied, copy } = useCopy(text);
  const { researching } = useResearchControl();
  return (
    <div className="group min-w-0 font-voice text-[14.5px] leading-[1.7] text-text">
      <Markdown text={text} />
      <div className="msg-actions mt-1 flex h-6 items-center gap-1 font-ui text-xs text-text-muted">
        <button type="button" onClick={copy} aria-label={t("message.copy")} title={t("message.copy")} className="msg-action">
          <SymbolIcon name="copy" className="size-3.5" />
          {copied && <span aria-live="polite">{t("copy.done")}</span>}
        </button>
        {researching && text.length >= REPORT_MIN_CHARS && (
          <button type="button" onClick={() => download(text)} aria-label={t("report.download")} title={t("report.download")} className="msg-action">
            <SymbolIcon name="download" className="size-3.5" />
            <span>{t("report.download")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
