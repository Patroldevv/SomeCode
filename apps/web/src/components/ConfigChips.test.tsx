import type { ConfigOption } from '@somecode/protocol';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { ConfigChips } from './ConfigChips.tsx';

beforeAll(() => setLanguageForTests('en'));
afterEach(() => vi.restoreAllMocks());

const opt = (id: string, name: string, category: string | undefined, currentValue: string, values: string[]): ConfigOption => ({
  id,
  name,
  ...(category ? { category } : {}),
  currentValue,
  choices: values.map((value) => ({ value, name: value })),
});

const CLAUDE: ConfigOption[] = [
  opt('agent', 'Agent', undefined, 'default', ['default', 'guide']),
  opt('effort', 'Effort', 'thought_level', 'high', ['low', 'medium', 'high']),
  opt('model', 'Model', 'model', 'sonnet', ['default', 'opus', 'sonnet', 'haiku']),
  opt('mode', 'Mode', 'mode', 'auto', ['default', 'plan', 'auto']),
];

function setup(props: Partial<React.ComponentProps<typeof ConfigChips>> = {}) {
  const onChange = vi.fn();
  const utils = render(<ConfigChips options={CLAUDE} disabled={false} pendingId={null} onChange={onChange} {...props} />);
  return { onChange, user: userEvent.setup(), ...utils };
}

describe('ConfigChips', () => {
  it('shows one chip per option, mode first, named "<option>: <value>"', () => {
    setup();
    const chips = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(chips).toEqual(['Mode: auto', 'Model: sonnet', 'Effort: high', 'Agent: default']);
  });

  it('renders nothing when the agent reports no options', () => {
    const { container } = setup({ options: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a menu on click, moves with the arrow keys and selects with Enter', async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole('button', { name: 'Model: sonnet' }));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['default', 'opus', 'sonnet', 'haiku']);
    expect(items[2]).toHaveAttribute('aria-checked', 'true');
    expect(items[2]).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenCalledWith('model', 'opus');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the chip', async () => {
    const { user, onChange } = setup();
    const chip = screen.getByRole('button', { name: 'Mode: auto' });
    await user.click(chip);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes when clicking outside', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Mode: auto' }));
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('filters a long list and says so when nothing matches', async () => {
    const many = [opt('model', 'Model', 'model', 'm0', Array.from({ length: 30 }, (_, i) => `m${i}`).concat(['opus-5']))];
    const { user, onChange } = setup({ options: many });
    await user.click(screen.getByRole('button', { name: 'Model: m0' }));
    const filter = screen.getByRole('textbox', { name: 'Filter options' });
    await user.type(filter, 'opu');
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['opus-5']);
    await user.clear(filter);
    await user.type(filter, 'zzz');
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    expect(screen.getByText('No matching options')).toBeInTheDocument();
    await user.clear(filter);
    await user.type(filter, 'm7');
    await user.click(screen.getByRole('menuitemradio', { name: 'm7' }));
    expect(onChange).toHaveBeenCalledWith('model', 'm7');
  });

  it('does not open while disabled', async () => {
    const { user } = setup({ disabled: true });
    const chip = screen.getByRole('button', { name: 'Model: sonnet' });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('marks the pending option busy', () => {
    setup({ pendingId: 'model' });
    expect(screen.getByRole('button', { name: 'Model: sonnet' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Mode: auto' })).not.toHaveAttribute('aria-busy', 'true');
  });

  it('renders agent-supplied names as text and survives duplicate ids without key warnings', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hostile = '<img src=x onerror=alert(1)>';
    const options = [
      { ...opt('model', hostile, 'model', 'a', ['a', hostile]), choices: [{ value: 'a', name: hostile }, { value: 'b', name: hostile }] },
      opt('model', 'Dup', 'model', 'a', ['a']),
    ];
    const { user, container } = setup({ options });
    await user.click(screen.getAllByRole('button')[0]!);
    expect(container.ownerDocument.querySelector('img')).toBeNull();
    expect(screen.getAllByText(hostile).length).toBeGreaterThan(0);
    expect(error).not.toHaveBeenCalled();
  });
});
