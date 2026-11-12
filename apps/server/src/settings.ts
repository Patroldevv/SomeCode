import { z } from 'zod';
import { parseApproval, type ApprovalLevel } from './permissions/approval.ts';
import { ENGINE_IDS } from './research/engines.ts';
import type { Store } from './store/store.ts';

/** Preferences that the server itself acts on (the browser keeps the rest). */
export const serverSettingsSchema = z.object({
  /** In plan mode, run read-only commands (ls, git status, ...) without asking. */
  planAutoApprove: z.boolean(),
  /** How much a new chat may do without asking: ask, auto (approve for me) or full (full access). */
  defaultApproval: z.enum(['ask', 'auto', 'full']),
  /** Tell an agent about the app (attachments, how to add skills, plugins and services) at the start of a chat. */
  agentGuide: z.boolean(),
  /** Tools that give agents a memory of past chats, notes about the project and scheduled tasks. */
  agentTools: z.boolean(),
  /** Within the agent tools: search and read earlier chats. */
  historySearch: z.boolean(),
  /** Within the agent tools: notes about the project (kept, listed and told to every chat). */
  projectMemory: z.boolean(),
  /** The agent may save notes on its own when it learns something lasting (off: only when asked to). */
  autoMemory: z.boolean(),
  /** Within the agent tools: tasks that start a chat later (and the scheduler that runs them). */
  scheduledTasks: z.boolean(),
  /** An agent proposes the project's checks on its own in a project that has none (the user still approves them). */
  autoChecks: z.boolean(),
  /** Deep research asks the user to approve (and edit) its plan before it starts. */
  researchPlan: z.boolean(),
  /** How much a deep research must cover before it reports. */
  researchDepth: z.enum(['standard', 'deep', 'exhaustive']),
  /** The search engines a deep research may use. */
  researchEngines: z.array(z.enum(ENGINE_IDS)).min(1),
  /** The browser tools for agents (open a page, screenshot, click, type): off, only addresses on this computer, or any web address. */
  browserTool: z.enum(['off', 'local', 'any']),
  /** Allow primary agents (e.g. Claude) to delegate large codebase scans to Gemini 3.8 Flash scout. */
  scoutSubagent: z.boolean(),
  /** Model to run for the Gemini Scout subagent. */
  scoutModel: z.string(),
  /** Reasoning effort for Gemini Scout ('default', 'low', 'medium', 'high', 'xhigh', 'max'). */
  scoutEffort: z.string(),
  /** Allow agents (e.g. Antigravity) to delegate deep analysis or coding to Claude Code. */
  claudeSubagent: z.boolean(),
  /** Model to run for the Claude subagent ('sonnet', 'opus', 'haiku'). */
  claudeModel: z.string(),
  /** Reasoning effort for Claude subagent ('default', 'low', 'medium', 'high', 'xhigh', 'max'). */
  claudeEffort: z.string(),
});
export type ServerSettings = z.infer<typeof serverSettingsSchema>;

export const settingsPatchSchema = serverSettingsSchema.partial().strict();

export const DEFAULT_SETTINGS: ServerSettings = {
  planAutoApprove: true,
  defaultApproval: 'ask',
  agentGuide: true,
  agentTools: true,
  historySearch: true,
  projectMemory: true,
  autoMemory: true,
  scheduledTasks: true,
  autoChecks: true,
  researchPlan: true,
  researchDepth: 'deep',
  researchEngines: ['google', 'yandex', 'bing', 'duckduckgo'],
  browserTool: 'local',
  scoutSubagent: true,
  scoutModel: 'gemini-3.8-flash',
  scoutEffort: 'default',
  claudeSubagent: true,
  claudeModel: 'sonnet',
  claudeEffort: 'default',
};
export const defaultApprovalLevel = (s: ServerSettings): ApprovalLevel => parseApproval(s.defaultApproval) ?? 'ask';
const KEY = 'server';

/**
 * Locked settings that are always enabled by design and cannot be turned off.
 */
export const LOCKED_SERVER_SETTINGS = {
  planAutoApprove: true,
  agentGuide: true,
} as const;

/** The saved settings; anything missing or unreadable falls back to the defaults. */
export function readSettings(store: Pick<Store, 'getSetting'>): ServerSettings {
  const raw = store.getSetting(KEY);
  if (raw === null) return DEFAULT_SETTINGS;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return DEFAULT_SETTINGS;
  // Field by field: one value that no longer fits (a removed option, a hand edit) falls back to its own default and
  // never takes the other settings down with it.
  const kept: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(serverSettingsSchema.shape)) {
    const value = (stored as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) kept[key] = parsed.data;
  }
  // The first version's default was not a model name any agent lists.
  if (kept['scoutModel'] === 'gemini-3.8-flash-high') delete kept['scoutModel'];
  return { ...DEFAULT_SETTINGS, ...kept, ...LOCKED_SERVER_SETTINGS } as ServerSettings;
}

export function updateSettings(store: Pick<Store, 'getSetting' | 'setSetting'>, patch: Partial<ServerSettings>): ServerSettings {
  const next = {
    ...readSettings(store),
    ...patch,
    ...LOCKED_SERVER_SETTINGS,
  };
  store.setSetting(KEY, JSON.stringify(next));
  return next;
}
