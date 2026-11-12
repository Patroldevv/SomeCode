import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSelect } from './SettingsSelect.tsx';

const options = [
  { value: 'ask', label: 'Ask', description: 'Always ask first' },
  { value: 'auto', label: 'Approve for me' },
  { value: 'full', label: 'Full access' },
];

function Host({ onChange = () => {}, disabled = false }: { onChange?: (v: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('ask');
  return <SettingsSelect label="Permissions" value={value} options={options} disabled={disabled} onChange={(v) => { setValue(v); onChange(v); }} />;
}

describe('SettingsSelect', () => {
  it('shows the current choice, opens a list with explanations and a check, and picks with a press', async () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Permissions' });
    expect(trigger).toHaveTextContent('Ask');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ask/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Always ask first')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Full access' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('full');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent('Full access');
    expect(trigger).toHaveFocus();
  });

  it('moves with the arrow keys, chooses with Enter, and closes with Escape without choosing', async () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    expect(screen.getByRole('option', { name: /Ask/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(screen.getByRole('option', { name: 'Approve for me' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('auto');
    await userEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('closes when another place is pressed, does nothing for the choice already made, and can be disabled', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Host onChange={onChange} />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    await userEvent.click(screen.getByRole('option', { name: /Ask/ }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('does not open while disabled', async () => {
    render(<Host disabled />);
    await userEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
