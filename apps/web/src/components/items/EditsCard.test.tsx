import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../../i18n/index.ts';
import { EditsCard } from './EditsCard.tsx';

beforeEach(() => setLanguageForTests('en'));

const file = (path: string) => ({ path, added: 3, removed: 1, toolKeys: [path], changes: [] });

describe('EditsCard', () => {
  it('counts the files, splits the path and offers the diffs', async () => {
    const onView = vi.fn();
    render(<EditsCard files={[file('src/a.ts')]} onView={onView} />);
    expect(screen.getByText('1 file edited')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View changes' }));
    expect(onView).toHaveBeenCalledOnce();
  });

  it('shows three files and unfolds the rest on request', async () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => file(`src/${n}.ts`));
    render(<EditsCard files={files} onView={() => {}} />);
    expect(screen.queryByText('d.ts')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show 2 more files' }));
    expect(screen.getByText('d.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('triggers rollback on button click and shows reverted state', async () => {
    const onRollback = vi.fn(async () => {});
    render(<EditsCard files={[file('src/auth.ts')]} onView={() => {}} onRollback={onRollback} />);

    const rollbackBtn = screen.getByRole('button', { name: /rollback/i });
    expect(rollbackBtn).toBeInTheDocument();

    await userEvent.click(rollbackBtn);
    expect(onRollback).toHaveBeenCalledOnce();

    expect(screen.getByRole('button', { name: /reverted/i })).toBeInTheDocument();
  });

  it('supports Turkish localization for rollback button', async () => {
    setLanguageForTests('tr');
    const onRollback = vi.fn(async () => {});
    render(<EditsCard files={[file('src/auth.ts')]} onView={() => {}} onRollback={onRollback} />);

    const rollbackBtn = screen.getByRole('button', { name: /Geri Al/i });
    expect(rollbackBtn).toBeInTheDocument();

    await userEvent.click(rollbackBtn);
    expect(onRollback).toHaveBeenCalledOnce();

    expect(screen.getByRole('button', { name: /Geri Alındı/i })).toBeInTheDocument();
  });
});
