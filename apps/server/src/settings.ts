import { z } from 'zod';
import { parseApproval, type ApprovalLevel } from './permissions/approval.ts';
import type { Store } from './store/store.ts';

/** Preferences that the server itself acts on (the browser keeps the rest). */
export const serverSettingsSchema = z.object({
  /** In plan mode, run read-only commands (ls, git status, ...) without asking. */
  planAutoApprove: z.boolean(),
  /** How much a new chat may do without asking: ask, auto (approve for me) or full (full access). */
  defaultApproval: z.enum(['ask', 'auto', 'full']),
  /** Tell an agent about the app (attachments, how to add skills, plugins and services) at the start of a chat. */
  agentGuide: z.boolean(),
});
export type ServerSettings = z.infer<typeof serverSettingsSchema>;

export const settingsPatchSchema = serverSettingsSchema.partial().strict();

export const DEFAULT_SETTINGS: ServerSettings = { planAutoApprove: true, defaultApproval: 'ask', agentGuide: true };
export const defaultApprovalLevel = (s: ServerSettings): ApprovalLevel => parseApproval(s.defaultApproval) ?? 'ask';
const KEY = 'server';

/** The saved settings; anything missing or unreadable falls back to the defaults. */
export function readSettings(store: Pick<Store, 'getSetting'>): ServerSettings {
  const raw = store.getSetting(KEY);
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    const parsed = serverSettingsSchema.partial().safeParse(JSON.parse(raw));
    return parsed.success ? { ...DEFAULT_SETTINGS, ...parsed.data } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function updateSettings(store: Pick<Store, 'getSetting' | 'setSetting'>, patch: Partial<ServerSettings>): ServerSettings {
  const next = { ...readSettings(store), ...patch };
  store.setSetting(KEY, JSON.stringify(next));
  return next;
}
