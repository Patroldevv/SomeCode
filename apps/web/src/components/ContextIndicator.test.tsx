import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { calculateContextStats, ContextIndicator } from './ContextIndicator.tsx';
import type { SessionState } from '../lib/sessionState.ts';

describe('calculateContextStats', () => {
  it('estimates tokens for empty state with default 200k limit', () => {
    const stats = calculateContextStats(null);
    expect(stats.maxTokens).toBe(200_000);
    expect(stats.usedTokens).toBeGreaterThan(0);
    expect(stats.percentage).toBeGreaterThan(0);
    expect(stats.bufferTokens).toBe(stats.maxTokens - stats.usedTokens);
  });

  it('detects 1M limit for Gemini models', () => {
    const state: Partial<SessionState> = {
      configOptions: [{ id: 'model', name: 'Model', category: 'model', currentValue: 'gemini-1.5-pro', choices: [] }],
      items: [],
    };
    const stats = calculateContextStats(state as SessionState);
    expect(stats.maxTokens).toBe(1_000_000);
  });

  it('aggregates tokens from messages and tool calls', () => {
    const state: Partial<SessionState> = {
      items: [
        { kind: 'user', key: 'u1', text: 'Hello, please write a program' },
        { kind: 'agent', key: 'a1', text: 'Sure, here is the program: ' + 'x'.repeat(400) },
        { kind: 'tool', key: 't1', id: 't1', title: 'test', toolKind: 'execute', status: 'completed', content: [{ type: 'text', text: 'Output: ' + 'y'.repeat(800) }] },
      ],
    };
    const stats = calculateContextStats(state as SessionState);
    expect(stats.messagesTokens).toBeGreaterThan(100);
    expect(stats.mcpToolsTokens).toBeGreaterThan(100);
  });
});

describe('ContextIndicator', () => {
  it('renders trigger button and toggles breakdown popover', () => {
    const onCompact = vi.fn();
    render(<ContextIndicator onCompact={onCompact} />);
    const button = screen.getByRole('button', { name: /bağlam penceresi/i });
    expect(button).toBeInTheDocument();

    // Initially popover is closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click to open
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Mesajlar')).toBeInTheDocument();
    expect(screen.getByText('Araçlar')).toBeInTheDocument();
    expect(screen.getByText('Sistem İstemi')).toBeInTheDocument();

    // Click compact button
    const compactBtn = screen.getByRole('button', { name: /oturumu sıkıştır/i });
    fireEvent.click(compactBtn);
    expect(onCompact).toHaveBeenCalledTimes(1);

    // Popover closes after compact
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
