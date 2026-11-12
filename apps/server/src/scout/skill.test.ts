import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureScoutBin, ensureScoutSkill } from './skill.ts';

describe('Scout Skill', () => {
  it('creates the ~/.claude/skills/scout/SKILL.md file and ~/.local/bin/somecode-scout launcher', async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), 'somecode-skill-test-'));
    try {
      const file = await ensureScoutSkill(fakeHome);
      expect(file).toBe(join(fakeHome, '.claude', 'skills', 'scout', 'SKILL.md'));
      const content = await readFile(file, 'utf8');
      expect(content).toContain('name: scout');
      expect(content).toContain('Gemini 3.8 Flash');
      expect(content).toContain('somecode-scout');

      const binFile = join(fakeHome, '.local', 'bin', 'somecode-scout');
      const binContent = await readFile(binFile, 'utf8');
      expect(binContent).toContain('#!/bin/sh');
      expect(binContent).toContain('bin/somecode-scout.ts');
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
