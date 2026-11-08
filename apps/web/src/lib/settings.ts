import { useSyncExternalStore } from 'react';

/** Preferences that only the browser needs (the server keeps its own, see the Settings page). */
export type ClientSettings = {
  /** Warn before the tab is closed while an agent is working. */
  confirmClose: boolean;
  /** Open the workspace panel (files, changes, terminal) when a project opens. */
  openPanelAtStart: boolean;
  /** Keep the computer awake while an agent is working. */
  preventSleep: boolean;
  /** Show the extra pickers (e.g. Agent) next to the model in the message box. */
  showAdvancedOptions: boolean;
  /** When the sub-agents an idle agent waited for are done, tell the agent so it picks up their results. */
  autoContinueSubagents: boolean;
  /** Enable or disable the subagent system. When disabled, the main agent handles all work directly without spawning subagents. */
  subagentsEnabled: boolean;
  /** Play a soft sound when a chat finishes, asks something or fails. */
  soundEnabled: boolean;
  /** Show a system notification for those, while this page is not in front. */
  notifyEnabled: boolean;
  /** Warn when an agent's limit falls to 10 % or less. */
  limitAlerts: boolean;
};

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  confirmClose: false,
  openPanelAtStart: false,
  preventSleep: false,
  showAdvancedOptions: false,
  autoContinueSubagents: true,
  subagentsEnabled: true,
  soundEnabled: true,
  notifyEnabled: false,
  limitAlerts: true,
};

const KEY = 'somecode.settings';

function read(): ClientSettings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<ClientSettings>;
    const next = { ...DEFAULT_CLIENT_SETTINGS };
    for (const key of Object.keys(DEFAULT_CLIENT_SETTINGS) as (keyof ClientSettings)[]) {
      if (typeof raw[key] === 'boolean') next[key] = raw[key];
    }
    return next;
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

let current: ClientSettings = read();
const listeners = new Set<() => void>();

export function getClientSettings(): ClientSettings {
  return current;
}

export function updateClientSettings(patch: Partial<ClientSettings>): void {
  current = { ...current, ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch {}
  for (const listener of listeners) listener();
}

/** Test hook: back to the defaults (and forget what was saved). */
export function resetClientSettingsForTests(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {}
  current = { ...DEFAULT_CLIENT_SETTINGS };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useClientSettings(): ClientSettings {
  return useSyncExternalStore(subscribe, getClientSettings);
}
