import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { AgentInfo, SessionInfo } from './api.ts';
import { addLocalUserMessage, applyEvent, initialState, type SessionState } from './sessionState.ts';
import { sessionLabel } from './sessionLabel.ts';

const NOW = 1_800_000_000_000;
const agents: AgentInfo[] = [{ id: 'claude', label: 'Claude Code', installed: true }];
const row = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 's1',
  projectId: 'p1',
  agentId: 'claude',
  createdAt: NOW - 5 * 60_000,
  title: null,
  ...over,
});
const withUser = (text: string): SessionState =>
  applyEvent(initialState(), { seq: 1, sessionId: 's1', ts: 0, event: { type: 'user_message', text } });

beforeEach(() => setLanguageForTests('en'));
afterEach(() => setLanguageForTests(null));

describe('sessionLabel', () => {
  it('uses the first user message when the state has one', () => {
    expect(sessionLabel(row(), withUser('Fix the login bug'), agents, NOW)).toBe('Fix the login bug');
  });

  it('shortens a long first message to 48 characters with an ellipsis', () => {
    const text = 'a'.repeat(60);
    const label = sessionLabel(row(), withUser(text), agents, NOW);
    expect(label).toHaveLength(48);
    expect(label).toBe(`${'a'.repeat(47)}…`);
  });

  it('keeps a message of exactly 48 characters as it is', () => {
    const text = 'b'.repeat(48);
    expect(sessionLabel(row(), withUser(text), agents, NOW)).toBe(text);
  });

  it('uses only the first line of a multi-line message', () => {
    expect(sessionLabel(row(), withUser('First line\nsecond line\nthird'), agents, NOW)).toBe('First line');
  });

  it('skips leading blank lines and counts an optimistic (local) message too', () => {
    const state = addLocalUserMessage(initialState(), '\n\n  Refactor the store  \nmore');
    expect(sessionLabel(row(), state, agents, NOW)).toBe('Refactor the store');
  });

  it('falls back to "<agent label> · <relative time>" without a user message', () => {
    expect(sessionLabel(row(), undefined, agents, NOW)).toBe('Claude Code · 5 min. ago');
    expect(sessionLabel(row(), initialState(), agents, NOW)).toBe('Claude Code · 5 min. ago');
  });

  it('formats the relative time in the active language', () => {
    setLanguageForTests('tr');
    expect(sessionLabel(row(), undefined, agents, NOW)).toBe('Claude Code · 5 dk. önce');
  });

  it('picks a sensible unit for the age', () => {
    expect(sessionLabel(row({ createdAt: NOW - 10_000 }), undefined, agents, NOW)).toBe('Claude Code · 10 sec. ago');
    expect(sessionLabel(row({ createdAt: NOW - 3 * 3_600_000 }), undefined, agents, NOW)).toBe('Claude Code · 3 hr. ago');
    expect(sessionLabel(row({ createdAt: NOW - 2 * 86_400_000 }), undefined, agents, NOW)).toBe('Claude Code · 2 days ago');
  });

  it('shows the raw agent id for an agent that is not in the list', () => {
    expect(sessionLabel(row({ agentId: 'mystery' }), undefined, agents, NOW)).toBe('mystery · 5 min. ago');
  });
});
