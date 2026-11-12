import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, readSettings, updateSettings } from './settings.ts';

const storeWith = (raw: string | null) => {
  let value = raw;
  return { getSetting: () => value, setSetting: (_k: string, v: string) => void (value = v) };
};

describe('readSettings', () => {
  it('keeps every valid setting when one of them no longer fits', () => {
    const store = storeWith(JSON.stringify({ defaultApproval: 'auto', researchDepth: 'bottomless', researchEngines: [], historySearch: false, browserTool: 'any', scoutModel: 'gemini-3.8-flash-high' }));
    expect(readSettings(store)).toMatchObject({
      defaultApproval: 'auto',
      historySearch: false,
      browserTool: 'any',
      researchDepth: DEFAULT_SETTINGS.researchDepth,
      researchEngines: DEFAULT_SETTINGS.researchEngines,
      scoutModel: DEFAULT_SETTINGS.scoutModel,
    });
  });

  it('falls back to the defaults for nothing, garbage or something that is not an object', () => {
    for (const raw of [null, 'not json', '[1,2]', '"text"', 'null']) expect(readSettings(storeWith(raw))).toEqual(DEFAULT_SETTINGS);
  });

  it('writes a patch on top of what is saved, never on top of defaults', () => {
    const store = storeWith(JSON.stringify({ browserTool: 'any' }));
    expect(updateSettings(store, { historySearch: false })).toMatchObject({ browserTool: 'any', historySearch: false });
    expect(readSettings(store)).toMatchObject({ browserTool: 'any', historySearch: false });
  });
});
