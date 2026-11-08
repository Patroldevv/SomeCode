import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { en } from '../i18n/en.ts';
import { ApiError, type AgentInfo } from '../lib/api.ts';
import { NewSessionDialog, type NewSessionInput } from './NewSessionDialog.tsx';

const agents: AgentInfo[] = [
  { id: 'ghost', label: 'Ghost Agent', installed: false },
  { id: 'claude', label: 'Claude Code', installed: true },
  { id: 'open', label: 'OpenCode', installed: true },
];

beforeEach(() => setLanguageForTests('en'));

function renderDialog(over: Partial<React.ComponentProps<typeof NewSessionDialog>> = {}) {
  const props = {
    open: true,
    agents,
    onClose: vi.fn(),
    onCreate: vi.fn(async (_input: NewSessionInput) => {}),
    onError: vi.fn(),
    ...over,
  };
  const view = render(<NewSessionDialog {...props} />);
  return { props, ...view };
}

const path = () => screen.getByRole('textbox', { name: 'Absolute project path' });
const name = () => screen.getByRole('textbox', { name: 'Project name' });
const submit = () => screen.getByRole('button', { name: 'Start session' });

describe('NewSessionDialog', () => {
  it('is a native modal dialog while open', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'New session' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
  });

  it('closes the native dialog when open turns false', () => {
    const { props, rerender } = renderDialog();
    rerender(<NewSessionDialog {...props} open={false} />);
    expect(document.querySelector('dialog')).not.toHaveAttribute('open');
  });

  it('a not-installed agent cannot be picked; the first installed one is selected', () => {
    renderDialog();
    const ghost = screen.getByRole('option', { name: 'Ghost Agent (not installed)' });
    expect(ghost).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Claude Code' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveValue('claude');
  });

  it('a relative path shows a hint and disables submit', async () => {
    renderDialog();
    await userEvent.type(path(), 'projects/app');
    expect(screen.getByText(en['newSession.pathRelative'])).toBeInTheDocument();
    expect(path()).toHaveAttribute('aria-invalid', 'true');
    expect(submit()).toBeDisabled();
    await userEvent.clear(path());
    await userEvent.type(path(), '/home/u/app');
    expect(screen.queryByText(en['newSession.pathRelative'])).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it('submit is disabled without a path', () => {
    renderDialog();
    expect(submit()).toBeDisabled();
  });

  it('submits {agentId, name, path} and closes on success', async () => {
    const { props } = renderDialog();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'open');
    await userEvent.type(name(), '  My app  ');
    await userEvent.type(path(), ' /home/u/app ');
    await userEvent.click(submit());
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith({ agentId: 'open', name: 'My app', path: '/home/u/app' });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('defaults the project name to the last path segment', async () => {
    const { props } = renderDialog();
    await userEvent.type(path(), '/home/u/somecode/');
    await userEvent.click(submit());
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith({ agentId: 'claude', name: 'somecode', path: '/home/u/somecode/' });
  });

  it('shows a failure with errorText inside the dialog and stays open', async () => {
    const { props } = renderDialog({
      onCreate: vi.fn(async () => {
        throw new ApiError('bad_request');
      }),
    });
    await userEvent.type(path(), '/nope');
    await userEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(en['error.bad_request']);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });

  it('a non-API failure shows the generic error', async () => {
    renderDialog({
      onCreate: vi.fn(async () => {
        throw new TypeError('boom');
      }),
    });
    await userEvent.type(path(), '/x');
    await userEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(en['error.internal']);
  });

  it('disables the form while busy', async () => {
    let finish!: () => void;
    const { props } = renderDialog({ onCreate: vi.fn(() => new Promise<void>((r) => (finish = r))) });
    await userEvent.type(path(), '/home/u/app');
    await userEvent.click(submit());
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(path()).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Agent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // Escape while busy does not close it either.
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('a failure after the dialog was closed meanwhile goes to onError, not the hidden dialog', async () => {
    let fail!: (err: unknown) => void;
    const { props, rerender } = renderDialog({
      onCreate: vi.fn(() => new Promise<void>((_resolve, reject) => (fail = reject))),
    });
    await userEvent.type(path(), '/home/u/app');
    await userEvent.click(submit());
    // The browser force-closes the modal (second Escape): the dialog's close event tells the parent.
    act(() => (screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement).close());
    expect(props.onClose).toHaveBeenCalledOnce();
    rerender(<NewSessionDialog {...props} open={false} />);
    await act(async () => fail(new ApiError('bad_request')));
    expect(props.onError).toHaveBeenCalledExactlyOnceWith('bad_request');
    expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
  });

  it('a failure while the dialog is open is shown in it, not via onError', async () => {
    const { props } = renderDialog({
      onCreate: vi.fn(async () => {
        throw new ApiError('bad_request');
      }),
    });
    await userEvent.type(path(), '/x');
    await userEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(en['error.bad_request']);
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('Cancel and Escape close through onClose', async () => {
    const { props } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('shows a placeholder option when no agents are available', () => {
    renderDialog({ agents: [] });
    expect(screen.getByRole('option', { name: 'No agents available' })).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });
});

describe('NewSessionDialog sign-in warning', () => {
  it('warns when the selected agent reports being signed out, without blocking', async () => {
    const signedOut: AgentInfo[] = [{ id: 'agy', label: 'Antigravity', installed: true, auth: 'signed_out' }];
    renderDialog({ agents: signedOut });
    expect(screen.getByText(en['newSession.signedOut'])).toBeInTheDocument();
    await userEvent.setup().type(path(), '/tmp');
    expect(submit()).toBeEnabled();
  });

  it('shows no warning for signed-in or unknown agents', () => {
    renderDialog();
    expect(screen.queryByText(en['newSession.signedOut'])).not.toBeInTheDocument();
  });
});
