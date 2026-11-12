import type { ConfigOption } from '@somecode/protocol';

/** The value of the "Deep research" entry SomeCode adds to an agent's mode menu. */
export const DEEP_RESEARCH = 'deep_research';

const isModeOption = (o: ConfigOption): boolean => o.id === 'mode' || o.category === 'mode';

/**
 * The agent's mode menu with "Deep research" added (it is SomeCode's own mode: the agent itself stays in its plain
 * mode and is given the research instructions with each message). While it is on, it is the menu's current value.
 */
export function withResearchMode(options: ConfigOption[], active: boolean): ConfigOption[] {
  return options.map((o) => {
    if (!isModeOption(o)) return o;
    const choices = o.choices.some((c) => c.value === DEEP_RESEARCH)
      ? o.choices
      : [...o.choices, { value: DEEP_RESEARCH, name: 'Deep research', description: 'Researches the question across many sources and writes a cited report.' }];
    return { ...o, choices, currentValue: active ? DEEP_RESEARCH : o.currentValue };
  });
}

/** The agent's own value to put it in when deep research is picked: its plain mode, never a self-approving one. */
export function plainValueOf(option: ConfigOption): string | null {
  const real = option.choices.filter((c) => c.value !== DEEP_RESEARCH);
  return (real.find((c) => /^(default|build|code|normal|agent)$/i.test(c.value)) ?? real[0])?.value ?? null;
}
