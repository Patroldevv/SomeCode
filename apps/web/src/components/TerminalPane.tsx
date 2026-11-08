import { useEffect, useRef, useState } from "react";
import { t, errorText } from "../i18n/index.ts";
import type { WorkspaceApi } from "../lib/workspaceApi.ts";
import type { Terminal as XTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { SymbolIcon } from "./SymbolIcon.tsx";
export function TerminalPane({
  api,
  projectId,
  loginAgent,
  visible = true,
}: {
  api: WorkspaceApi;
  projectId: string;
  loginAgent?: string;
  visible?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [started, setStarted] = useState(Boolean(loginAgent));
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const fitRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.());
  }, [visible]);
  useEffect(() => {
    if (!started || !host.current) return;
    let alive = true,
      id: string | undefined,
      term: XTerminal | undefined,
      observer: ResizeObserver | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let input = Promise.resolve();
    setExited(false);
    setError(null);
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        if (!alive) return;
        term = new Terminal({
          cursorBlink: true,
          screenReaderMode: true,
          fontSize: 12,
          fontFamily: '"DejaVu Sans Mono",monospace',
          scrollback: 2000,
          theme: {
            background: "#111111",
            foreground: "#dedede",
            cursor: "#f3f3f3",
            selectionBackground: "#3a3a3a",
          },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host.current!);
        const created = await (loginAgent
          ? api.login(loginAgent)
          : api.terminal(projectId));
        id = created.id;
        if (!alive) {
          await api.closeTerminal(id);
          return;
        }
        const resize = () => {
          try {
            fit.fit();
            if (id && term && term.cols > 1 && term.rows > 1)
              void api.resize(id, term.cols, term.rows).catch(() => {});
          } catch {}
        };
        fitRef.current = resize;
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(host.current!);
        term.onData((data) => {
          input = input
            .then(() => (id ? api.input(id, data) : undefined))
            .catch(() => {
              if (alive) setError(errorText("network"));
            });
        });
        let cursor = 0;
        const poll = async () => {
          if (!alive || !id) return;
          try {
            const output = await api.output(id, cursor);
            if (!alive) return;
            cursor = output.cursor;
            setError(null);
            if (output.output) term?.write(output.output);
            if (output.exited) {
              setExited(true);
              return;
            }
            timer = setTimeout(() => void poll(), 180);
          } catch {
            if (alive) {
              setError(errorText("network"));
              timer = setTimeout(() => void poll(), 1000);
            }
          }
        };
        void poll();
        term.focus();
      } catch {
        if (alive) setError(errorText("internal"));
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      observer?.disconnect();
      fitRef.current = null;
      term?.dispose();
      if (id) void api.closeTerminal(id).catch(() => {});
    };
  }, [api, projectId, loginAgent, started, generation]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!started ? (
        <div className="panel-empty">
          <SymbolIcon name="terminal" className="mb-3 size-8" />
          <p>{t("panel.terminalHint")}</p>
          <button
            className="small-button mt-4"
            onClick={() => setStarted(true)}
          >
            {t("panel.startTerminal")}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-text-muted">
            <span>
              {loginAgent ? `${loginAgent} · ${t("panel.signIn")}` : t("panel.terminal")}{" "}
              {exited && `· ${t("panel.terminalExit")}`}
            </span>
            <button
              className="icon-button"
              title={t("panel.restartTerminal")}
              aria-label={t("panel.restartTerminal")}
              onClick={() => setGeneration((n) => n + 1)}
            >
              <SymbolIcon name="plus" />
            </button>
          </div>
          {loginAgent && (
            <p className="px-3 py-2 text-xs leading-5 text-text-muted">
              {t("panel.authHint")}
            </p>
          )}
          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div ref={host} className="terminal-host min-h-0 flex-1 p-2" />
        </>
      )}
    </div>
  );
}
