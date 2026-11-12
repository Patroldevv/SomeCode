import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { ConfirmUndoDialog } from './ConfirmUndoDialog.tsx';

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setLanguageForTests('en');
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  setLanguageForTests(null);
});

describe('ConfirmUndoDialog', () => {
  it('does not render when closed', () => {
    render(<ConfirmUndoDialog open={false} hasFileEdits={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders with no-edits description when hasFileEdits is false', () => {
    render(<ConfirmUndoDialog open={true} hasFileEdits={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Confirm Undo')).toBeInTheDocument();
    expect(screen.getByText('This undo action will not make any code changes.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Revert file changes' })).not.toBeChecked();
  });

  it('renders with has-edits description and checked checkbox when hasFileEdits is true', () => {
    render(<ConfirmUndoDialog open={true} hasFileEdits={true} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Confirming this undo action will make the following changes:')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Revert file changes' })).toBeChecked();
  });

  it('renders scrollable list of files with inverse diff stats', async () => {
    const user = userEvent.setup();
    const files = [
      { path: 'src/MessageList.tsx', added: 1, removed: 1, toolKeys: ['1'], changes: [] },
      { path: 'src/edits.ts', added: 9, removed: 6, toolKeys: ['2'], changes: [] },
    ];
    const { rerender } = render(
      <ConfirmUndoDialog open={true} files={files} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(screen.getByText('MessageList.tsx')).toBeInTheDocument();
    expect(screen.getByText('edits.ts')).toBeInTheDocument();
    // Inverting stats: +removed -added
    expect(screen.getByText('+6')).toBeInTheDocument();
    expect(screen.getByText('-9')).toBeInTheDocument();

    // When checkbox is unchecked, file list hides
    const checkbox = screen.getByRole('checkbox', { name: 'Revert file changes' });
    await user.click(checkbox);
    expect(screen.queryByText('MessageList.tsx')).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel or close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmUndoDialog open={true} hasFileEdits={false} onClose={onClose} onConfirm={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmUndoDialog open={true} hasFileEdits={false} onClose={onClose} onConfirm={vi.fn()} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm with checkbox state and closes when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmUndoDialog open={true} hasFileEdits={true} onClose={onClose} onConfirm={onConfirm} />);

    const checkbox = screen.getByRole('checkbox', { name: 'Revert file changes' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(onConfirm).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when Enter key is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmUndoDialog open={true} hasFileEdits={true} onClose={onClose} onConfirm={onConfirm} />);

    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports Turkish localization', () => {
    setLanguageForTests('tr');
    render(<ConfirmUndoDialog open={true} hasFileEdits={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Geri Almayı Onayla')).toBeInTheDocument();
    expect(screen.getByText('Bu geri alma işlemi herhangi bir kod değişikliği yapmayacak.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İptal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Onayla/ })).toBeInTheDocument();
  });
});
