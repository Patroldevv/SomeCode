import { describe, expect, it } from 'vitest';
import { agentGuide } from './agentGuide.ts';

describe('agentGuide', () => {
  it('tells an agent where skills go (with the real home), how to add plugins and services, and about attachments', () => {
    const guide = agentGuide('/home/someone');
    expect(guide).toContain('/home/someone/.claude/skills/<name>/SKILL.md');
    expect(guide).toContain('/home/someone/.gemini/config/skills/<name>/SKILL.md');
    expect(guide).toContain('claude plugin install');
    expect(guide).toContain('claude mcp add --transport http -s user');
    expect(guide).toContain('<attached-file name="...">');
  });
});
