import { t } from '../i18n/index.ts';
import type { ConfigOption } from '@somecode/protocol';

const PRIMARY_ORDER = ['approval', 'mode', 'model', 'thought_level'];

/** Options worth a chip: mode, model and effort first, then everything else in the agent's own order. */
export function chipOrder(options: readonly ConfigOption[] | null | undefined): ConfigOption[] {
  const usable = (options ?? []).filter((o) => o.choices.length > 0);
  const rank = (o: ConfigOption) => {
    const i = o.category ? PRIMARY_ORDER.indexOf(o.category) : -1;
    return i === -1 ? PRIMARY_ORDER.length : i;
  };
  // Array.prototype.sort is stable: equal ranks keep the agent's order.
  return [...usable].sort((a, b) => rank(a) - rank(b));
}

/** SomeCode's own "Deep research" entry of the mode menu, named and explained in the user's language. */
export function localizeModeOptions(options: readonly ConfigOption[]): ConfigOption[] {
  return options.map((o) =>
    o.choices.some((c) => c.value === 'deep_research')
      ? { ...o, choices: o.choices.map((c) => (c.value === 'deep_research' ? { ...c, name: t('mode.deepResearch'), description: t('mode.deepResearch.hint') } : c)) }
      : o,
  );
}

/** The option's display name and the display name of its current choice (the raw value if it isn't listed). */
export function chipLabel(option: ConfigOption): { name: string; value: string } {
  const current = option.choices.find((c) => c.value === option.currentValue);
  return { name: option.name, value: current?.name ?? option.currentValue };
}

const PRIMARY_IDS = new Set(['approval', 'mode', 'model', 'effort', 'thought_level', 'reasoning', 'thinking']);

export function isEffortOption(o: ConfigOption): boolean {
  if (o.category === 'thought_level' || o.category === 'effort' || o.category === 'reasoning') return true;
  if (/^(thought_level|thought|effort|reasoning|thinking)$/i.test(o.id)) return true;
  if (/^(thought|effort|reasoning|thinking|düşünce)/i.test(o.name)) return true;
  return false;
}

export function isModelOption(o: ConfigOption): boolean {
  return o.category === 'model' || /^model$/i.test(o.id) || /^model/i.test(o.name);
}

/** The pickers every chat needs: mode, model and effort (by category, or by the id agents commonly use). */
export function isPrimaryOption(o: ConfigOption): boolean {
  return (o.category !== undefined && PRIMARY_ORDER.includes(o.category)) || PRIMARY_IDS.has(o.id) || isEffortOption(o) || isModelOption(o);
}

/** Whether the mode menu is on SomeCode's "Deep research" entry. */
export function isResearchMode(options: readonly ConfigOption[] | null | undefined): boolean {
  return (options ?? []).some((o) => (o.id === 'mode' || o.category === 'mode') && o.currentValue === 'deep_research');
}
