import { ENGINE_IDS, ENGINE_NAMES, type EngineId } from './engines.ts';

export type Depth = 'standard' | 'deep' | 'exhaustive';

/** What a research of each depth has to cover before the report: engines tried, sources noted, phrasings per step. */
export const DEPTHS: Record<Depth, { engines: number; sources: number; variants: number; label: string }> = {
  standard: { engines: 2, sources: 8, variants: 2, label: 'standard' },
  deep: { engines: 3, sources: 15, variants: 3, label: 'deep' },
  exhaustive: { engines: 4, sources: 25, variants: 4, label: 'exhaustive' },
};

export const isDepth = (value: unknown): value is Depth => value === 'standard' || value === 'deep' || value === 'exhaustive';

export type Source = { url: string; title: string; finding: string; confidence: 'high' | 'medium' | 'low'; step?: number };
export type Search = { engine: EngineId; query: string; hits: number; blocked: boolean; step?: number };

/** What one research has done so far: the searches, the pages read and the sources noted down. */
export type Ledger = { searches: Search[]; pages: Set<string>; sources: Map<string, Source>; steps: { content: string; status: string }[] };

export const createLedger = (): Ledger => ({ searches: [], pages: new Set(), sources: new Map(), steps: [] });

/** The enabled engine used the fewest times so far, so that a research spreads over all of them. */
export function pickEngine(ledger: Ledger, enabled: readonly EngineId[]): EngineId {
  const order = ENGINE_IDS.filter((e) => enabled.includes(e));
  const pool = order.length > 0 ? order : [...ENGINE_IDS];
  const used = (e: EngineId) => ledger.searches.filter((s) => s.engine === e && !s.blocked).length;
  // A robot check does not go away within a chat: an engine that showed one is left alone.
  const blocked = (e: EngineId) => ledger.searches.some((s) => s.engine === e && s.blocked);
  const open = pool.filter((e) => !blocked(e));
  return [...(open.length > 0 ? open : pool)].sort((a, b) => used(a) - used(b))[0]!;
}

/** The research's progress against what its depth asks for, in words the agent can act on. */
export function statusReport(ledger: Ledger, depth: Depth, enabled: readonly EngineId[]): string {
  const need = DEPTHS[depth];
  const worked = ledger.searches.filter((s) => !s.blocked);
  const usedEngines = [...new Set(worked.map((s) => s.engine))];
  const wanted = Math.min(need.engines, Math.max(1, enabled.length));
  const perEngine = usedEngines.map((e) => `${ENGINE_NAMES[e]} ${worked.filter((s) => s.engine === e).length}`).join(', ') || 'none yet';
  const done = ledger.steps.filter((s) => s.status === 'completed').length;
  const lines = [
    `Depth: ${need.label}.`,
    `Searches: ${worked.length} (${perEngine}); ${ledger.searches.length - worked.length} blocked by a robot check.`,
    `Pages read: ${ledger.pages.size}. Sources noted: ${ledger.sources.size} (${[...ledger.sources.values()].filter((s) => s.confidence === 'high').length} high confidence).`,
    ledger.steps.length > 0 ? `Plan: ${done}/${ledger.steps.length} steps done.` : 'Plan: none yet (call research_plan).',
  ];
  const todo: string[] = [];
  if (usedEngines.length < wanted) todo.push(`use more engines (${usedEngines.length}/${wanted}): try ${enabled.filter((e) => !usedEngines.includes(e)).map((e) => ENGINE_NAMES[e]).join(', ') || 'another'}`);
  if (ledger.sources.size < need.sources) todo.push(`note more sources (${ledger.sources.size}/${need.sources}) with research_note`);
  if (ledger.steps.length > 0 && done < ledger.steps.length) todo.push(`finish the plan (${ledger.steps.length - done} steps left)`);
  const lowSteps = ledger.steps.map((_, i) => i + 1).filter((n) => ledger.searches.filter((s) => s.step === n).length < need.variants && ledger.steps[n - 1]?.status !== 'completed');
  if (ledger.steps.length > 0 && lowSteps.length > 0) todo.push(`search steps ${lowSteps.join(', ')} with at least ${need.variants} different phrasings each (pass step=N to web_search)`);
  lines.push(todo.length === 0 ? 'Coverage reached: you may write the report now (or dig further where sources conflict).' : `Not yet enough: ${todo.join('; ')}.`);
  return lines.join('\n');
}
