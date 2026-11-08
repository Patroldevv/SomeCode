import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolGroup } from './ToolGroup.tsx';
import type { ToolItem } from '../../lib/sessionState.ts';
import { setLanguageForTests } from '../../i18n/index.ts';

function makeTool(key: string, title: string, status: ToolItem['status'] = 'completed', toolKind: ToolItem['toolKind'] = 'read', rawInput?: unknown): ToolItem {
  return {
    kind: 'tool',
    key,
    id: `call_${key}`,
    title,
    toolKind,
    status,
    content: [],
    ...(rawInput !== undefined ? { rawInput } : {}),
  };
}

describe('ToolGroup component (tr)', () => {
  beforeEach(() => {
    setLanguageForTests('tr');
  });
  afterEach(() => {
    setLanguageForTests(null);
  });

  it('renders a collapsed group header with action count and summary in Turkish', () => {
    const t1 = makeTool('1', 'File src/a.ts', 'completed', 'read', { Path: 'src/a.ts' });
    const t2 = makeTool('2', 'File src/b.ts', 'completed', 'read', { Path: 'src/b.ts' });

    render(<ToolGroup calls={[t1, t2]} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent(/2 işlem/);
    expect(button).toHaveTextContent(/Dosyalar incelendi/);
  });

  it('renders running state with spinner and current action in Turkish', () => {
    const t1 = makeTool('1', 'File src/a.ts', 'completed', 'read', { Path: 'src/a.ts' });
    const t2 = makeTool('2', 'File src/b.ts', 'in_progress', 'read', { Path: 'src/b.ts' });

    render(<ToolGroup calls={[t1, t2]} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent(/Okunuyor b\.ts/);
    expect(button).toHaveTextContent(/2 işlem/);
  });

  it('toggles open on click to show child tools', async () => {
    const user = userEvent.setup();
    const t1 = makeTool('1', 'File src/a.ts', 'completed', 'read', { Path: 'src/a.ts' });
    const t2 = makeTool('2', 'File src/b.ts', 'completed', 'read', { Path: 'src/b.ts' });

    render(<ToolGroup calls={[t1, t2]} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/a\.ts okundu/)).toBeInTheDocument();
    expect(screen.getByText(/b\.ts okundu/)).toBeInTheDocument();
  });
});
