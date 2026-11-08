import type { ConfigOption } from '@somecode/protocol';

const PRIMARY_ORDER = ['mode', 'model', 'thought_level'];

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

/** The option's display name and the display name of its current choice (the raw value if it isn't listed). */
export function chipLabel(option: ConfigOption): { name: string; value: string } {
  const current = option.choices.find((c) => c.value === option.currentValue);
  return { name: option.name, value: current?.name ?? option.currentValue };
}
