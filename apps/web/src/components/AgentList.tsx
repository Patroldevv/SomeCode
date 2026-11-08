import type { MessageKey } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import type { AgentInfo } from "../lib/api.ts";
import { CommandHint } from "./CommandHint.tsx";

function status(agent: AgentInfo): {
  key: MessageKey;
  tone: string;
  hint?: string;
} {
  if (!agent.installed)
    return {
      key: "agent.status.notInstalled",
      tone: "bg-text-muted/40",
      ...(agent.installHint ? { hint: agent.installHint } : {}),
    };
  if (agent.auth === "signed_out")
    return {
      key: "agent.status.signedOut",
      tone: "bg-warning",
      ...(agent.signInHint ? { hint: agent.signInHint } : {}),
    };
  if (agent.auth === "signed_in")
    return { key: "agent.status.signedIn", tone: "bg-success" };
  return { key: "agent.status.installed", tone: "bg-text-muted" };
}

/** The agents this machine knows, each with its install/sign-in state in words (and the command to fix it). */
export function AgentList({
  agents,
  onSignIn,
}: {
  agents: AgentInfo[];
  onSignIn?: (id: string) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <section
      aria-label={t("agent.list")}
      className="px-4 pb-4 pt-1 font-ui text-xs"
    >
      <h2 className="sr-only">{t("agent.list")}</h2>
      <ul className="flex flex-col gap-1.5">
        {agents.map((agent) => {
          const s = status(agent);
          return (
            <li
              key={agent.id}
              aria-label={agent.label}
              className={`flex flex-col gap-1 ${agent.installed ? "" : "opacity-70"}`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-block size-1.5 shrink-0 rounded-full ${s.tone}`}
                />
                <span className="truncate text-text">{agent.label}</span>
                <span
                  className={
                    agent.installed && agent.auth !== "signed_out"
                      ? "sr-only"
                      : "ml-auto shrink-0 text-text-muted"
                  }
                >
                  {t(s.key)}
                </span>
              </span>
              {s.hint && <CommandHint command={s.hint} />}
              {agent.installed && agent.auth !== "signed_in" && onSignIn && (
                <button
                  className="agent-signin"
                  onClick={() => onSignIn(agent.id)}
                >
                  {t("panel.signIn")} ↗
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
