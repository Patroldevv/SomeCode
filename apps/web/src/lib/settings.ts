import { useSyncExternalStore } from 'react';
import { findTheme } from './codeTheme.ts';

/** Preferences that only the browser needs (the server keeps its own, see the Settings page). */
export type TranscriptView = 'normal' | 'thinking' | 'detailed';

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
  /** Light syntax theme for code blocks & diffs */
  codeThemeLight: string;
  /** Dark syntax theme for code blocks & diffs */
  codeThemeDark: string;
  /** Custom monospace font family for code & terminal */
  codeFontFamily: string;
  /** Code font size in pixels (default 13) */
  codeFontSize: number;
  /** Default transcript view for sessions: normal, thinking, detailed */
  defaultTranscriptView: TranscriptView;
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
  codeThemeLight: 'claude-light',
  codeThemeDark: 'claude-dark',
  codeFontFamily: '',
  codeFontSize: 13,
  defaultTranscriptView: 'normal',
};

const KEY = 'somecode.settings';

export function applyAppearanceSettings(settings: ClientSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (settings.codeFontFamily && settings.codeFontFamily.trim()) {
    root.style.setProperty('--font-mono', `"${settings.codeFontFamily.trim()}", ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`);
  } else {
    root.style.removeProperty('--font-mono');
  }
  // The syntax theme is read by the highlighter; this attribute tells open code blocks to colour themselves again.
  root.dataset['codeTheme'] = `${settings.codeThemeLight}|${settings.codeThemeDark}`;
  for (const [mode, def] of [['light', findTheme(settings.codeThemeLight, true)], ['dark', findTheme(settings.codeThemeDark, false)]] as const) {
    root.style.setProperty(`--diff-add-bg-${mode}`, def.addBg);
    root.style.setProperty(`--diff-del-bg-${mode}`, def.delBg);
  }
  if (settings.codeFontSize && settings.codeFontSize >= 10 && settings.codeFontSize <= 24) {
    root.style.setProperty('--code-font-size', `${settings.codeFontSize}px`);
  } else {
    root.style.removeProperty('--code-font-size');
  }
}

function read(): ClientSettings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<ClientSettings>;
    const next = { ...DEFAULT_CLIENT_SETTINGS };
    if (typeof raw.confirmClose === 'boolean') next.confirmClose = raw.confirmClose;
    if (typeof raw.openPanelAtStart === 'boolean') next.openPanelAtStart = raw.openPanelAtStart;
    if (typeof raw.preventSleep === 'boolean') next.preventSleep = raw.preventSleep;
    if (typeof raw.showAdvancedOptions === 'boolean') next.showAdvancedOptions = raw.showAdvancedOptions;
    if (typeof raw.autoContinueSubagents === 'boolean') next.autoContinueSubagents = raw.autoContinueSubagents;
    if (typeof raw.subagentsEnabled === 'boolean') next.subagentsEnabled = raw.subagentsEnabled;
    if (typeof raw.soundEnabled === 'boolean') next.soundEnabled = raw.soundEnabled;
    if (typeof raw.notifyEnabled === 'boolean') next.notifyEnabled = raw.notifyEnabled;
    if (typeof raw.limitAlerts === 'boolean') next.limitAlerts = raw.limitAlerts;
    if (typeof raw.codeThemeLight === 'string') next.codeThemeLight = raw.codeThemeLight;
    if (typeof raw.codeThemeDark === 'string') next.codeThemeDark = raw.codeThemeDark;
    if (typeof raw.codeFontFamily === 'string') next.codeFontFamily = raw.codeFontFamily;
    if (typeof raw.codeFontSize === 'number' && Number.isFinite(raw.codeFontSize)) next.codeFontSize = raw.codeFontSize;
    if (raw.defaultTranscriptView === 'normal' || raw.defaultTranscriptView === 'thinking' || raw.defaultTranscriptView === 'detailed') {
      next.defaultTranscriptView = raw.defaultTranscriptView;
    }
    return next;
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

let current: ClientSettings = read();
applyAppearanceSettings(current);
const listeners = new Set<() => void>();

export function getClientSettings(): ClientSettings {
  return current;
}

export function updateClientSettings(patch: Partial<ClientSettings>): void {
  current = { ...current, ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch {}
  applyAppearanceSettings(current);
  for (const listener of listeners) listener();
}

/** Test hook: back to the defaults (and forget what was saved). */
export function resetClientSettingsForTests(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {}
  current = { ...DEFAULT_CLIENT_SETTINGS };
  applyAppearanceSettings(current);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useClientSettings(): ClientSettings {
  return useSyncExternalStore(subscribe, getClientSettings);
}
