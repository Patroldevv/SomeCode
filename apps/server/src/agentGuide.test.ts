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
    expect(guide).not.toContain('Gemini 3.8 Flash');
  });

  it('includes scout subagent instructions when scoutSubagent is enabled', () => {
    const guide = agentGuide('/home/someone', { scoutSubagent: true });
    expect(guide).toContain('Gemini Scout Subagent');
    expect(guide).toContain('somecode-scout');
  });

  it('includes claude subagent instructions when claudeSubagent is enabled', () => {
    const guide = agentGuide('/home/someone', { claudeSubagent: true, claudeModel: 'sonnet' });
    expect(guide).toContain('Claude Subagent');
    expect(guide).toContain('somecode-claude');
  });
});

describe('agentGuide browser tools', () => {
  it('describes the browser tools only when they are on, and says what the address limit is', () => {
    expect(agentGuide('/h')).not.toContain('BROWSER TOOLS');
    expect(agentGuide('/h', { browserTool: 'off' })).not.toContain('BROWSER TOOLS');
    expect(agentGuide('/h', { browserTool: 'local' })).toContain('only addresses on this computer');
    expect(agentGuide('/h', { browserTool: 'any' })).toContain('any http(s) address can be opened');
  });

  it('asks the agent to propose checks on its own only when the project has none', () => {
    const on = agentGuide('/home/someone', { agentTools: true, proposeChecks: true });
    expect(on).toContain('has no checks yet');
    expect(on).toContain('checks_propose');
    expect(on).toContain('never instead of it');
    expect(agentGuide('/home/someone', { agentTools: true })).not.toContain('has no checks yet');
    expect(agentGuide('/home/someone', { agentTools: false, proposeChecks: true })).not.toContain('checks_propose');
  });
});
