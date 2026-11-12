import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { AppErrorBoundary } from './AppErrorBoundary.tsx';

beforeAll(() => setLanguageForTests('en'));

let broken = true;
function Bomb() {
  if (broken) throw new Error('boom in render');
  return <p>all good</p>;
}

describe('AppErrorBoundary', () => {
  it('shows what went wrong instead of an empty page, and lets the user try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppErrorBoundary><Bomb /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('boom in render');
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('all good')).toBeInTheDocument();
  });
});
