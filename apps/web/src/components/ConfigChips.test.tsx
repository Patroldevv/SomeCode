import type { ConfigOption } from '@somecode/protocol';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

const NO_EFFORT = CLAUDE.filter((o) => o.id !== 'effort');

function setup(props: Partial<React.ComponentProps<typeof ConfigChips>> = {}) {
  const onChange = vi.fn();
  const utils = render(<ConfigChips options={CLAUDE} disabled={false} pendingId={null} onChange={onChange} {...props} />);
  return { onChange, user: userEvent.setup(), ...utils };
}

describe('ConfigChips', () => {
  it('shows one chip per option, mode first; model and effort share one picker at the end', () => {
    setup();
    const chips = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(chips).toEqual(['Mode: auto', 'Agent: default', 'Model and effort: sonnet, high']);
  });

  it('keeps the model picker for a model without effort levels, opening straight onto the models', async () => {
    const { user } = setup({ options: NO_EFFORT });
    const chips = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(chips).toEqual(['Mode: auto', 'Agent: default', 'Model: sonnet']);
    await user.click(screen.getByRole('button', { name: 'Model: sonnet' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('can hide the extra pickers (Agent) and keep mode, model and effort', () => {
    setup({ advanced: false });
    const chips = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(chips).toEqual(['Mode: auto', 'Model and effort: sonnet, high']);
  });

  it('renders nothing when the agent reports no options', () => {
    const { container } = setup({ options: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a menu on click, moves with the arrow keys and selects with Enter', async () => {
    const { user, onChange } = setup({ options: NO_EFFORT });
    await user.click(screen.getByRole('button', { name: 'Model: sonnet' }));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent?.replace('✓', ''))).toEqual(['default', 'opus', 'sonnet', 'haiku']);
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
    const { user } = setup({ disabled: true, options: NO_EFFORT });
    const chip = screen.getByRole('button', { name: 'Model: sonnet' });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('marks the pending option busy', () => {
    setup({ pendingId: 'model', options: NO_EFFORT });
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

  describe('model and effort picker', () => {
    const trigger = () => screen.getByRole('button', { name: 'Model and effort: sonnet, high' });

    it('opens a card with the effort slider and the model name', async () => {
      const { user } = setup();
      await user.click(trigger());
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('slider', { name: 'Effort' })).toHaveAttribute('aria-valuetext', 'high');
      expect(within(dialog).getByRole('button', { name: 'sonnet' })).toBeInTheDocument();
    });

    it('requests the new effort once the slider is released, not while it moves', async () => {
      const { user, onChange } = setup();
      await user.click(trigger());
      const slider = screen.getByRole('slider', { name: 'Effort' });
      fireEvent.change(slider, { target: { value: '0' } });
      expect(slider).toHaveAttribute('aria-valuetext', 'low');
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyUp(slider);
      expect(onChange).toHaveBeenCalledWith('effort', 'low');
    });

    it('pressing the model name lists the models; choosing one closes the card', async () => {
      const { user, onChange } = setup();
      await user.click(trigger());
      await user.click(screen.getByRole('button', { name: 'sonnet' }));
      const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
      expect(items.map((i) => i.textContent?.replace('✓', ''))).toEqual(['default', 'opus', 'sonnet', 'haiku']);
      expect(items[2]).toHaveAttribute('aria-checked', 'true');
      await user.click(items[1]!);
      expect(onChange).toHaveBeenCalledWith('model', 'opus');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Escape steps back from the model list, then closes and returns focus', async () => {
      const { user } = setup();
      await user.click(trigger());
      await user.click(screen.getByRole('button', { name: 'sonnet' }));
      await user.keyboard('{Escape}');
      expect(screen.getByRole('slider', { name: 'Effort' })).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger()).toHaveFocus();
    });

    it('is busy while either option is pending and cannot open while disabled', async () => {
      const { rerender, user, onChange } = setup({ pendingId: 'effort' });
      expect(trigger()).toHaveAttribute('aria-busy', 'true');
      rerender(<ConfigChips options={CLAUDE} disabled pendingId={null} onChange={onChange} />);
      expect(trigger()).toBeDisabled();
      await user.click(trigger());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('lists Default-like models first, whatever order the agent sent', async () => {
      const options = [
        opt('effort', 'Effort', 'thought_level', 'high', ['low', 'high']),
        opt('model', 'Model', 'model', 'opus', ['opus', 'sonnet', 'default']),
      ];
      const { user } = setup({ options });
      await user.click(screen.getByRole('button', { name: 'Model and effort: opus, high' }));
      await user.click(screen.getByRole('button', { name: 'opus' }));
      expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent?.replace('✓', ''))).toEqual(['default', 'opus', 'sonnet']);
    });

    it('tints the slider violet on the max step only', async () => {
      const options = [
        opt('effort', 'Effort', 'thought_level', 'max', ['low', 'high', 'max']),
        opt('model', 'Model', 'model', 'opus', ['opus']),
      ];
      const { user } = setup({ options });
      await user.click(screen.getByRole('button', { name: 'Model and effort: opus, max' }));
      const slider = screen.getByRole('slider', { name: 'Effort' });
      expect(slider.parentElement).toHaveClass('effort-max');
      fireEvent.change(slider, { target: { value: '1' } });
      expect(slider.parentElement).not.toHaveClass('effort-max');
    });
  });

  describe('permissions (access level)', () => {
    const approval = {
      id: 'approval',
      name: 'Permissions',
      category: 'approval',
      currentValue: 'ask',
      choices: ['ask', 'auto', 'full'].map((value) => ({ value, name: value })),
    };

    it('comes first, named in our own words, and changes the level from its menu', async () => {
      const { user, onChange } = setup({ options: [...NO_EFFORT, approval] });
      const chips = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      expect(chips[0]).toBe('Permissions: Ask for approval');
      await user.click(screen.getByRole('button', { name: 'Permissions: Ask for approval' }));
      const items = within(screen.getByRole('menu', { name: 'How should actions be approved?' })).getAllByRole('menuitemradio');
      expect(items.map((i) => i.textContent?.replace('✓', ''))).toEqual([
        'Ask for approvalAlways ask before running commands or editing files',
        'Approve for meOnly ask about actions that may be unsafe',
        'Full accessUnrestricted access to the internet and all files on your computer',
      ]);
      expect(items[0]).toHaveAttribute('aria-checked', 'true');
      await user.click(items[2]!);
      expect(onChange).toHaveBeenCalledWith('approval', 'full');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('stays visible without the extra pickers, and marks full access', () => {
      setup({ options: [...NO_EFFORT, { ...approval, currentValue: 'full' }], advanced: false });
      const chip = screen.getByRole('button', { name: 'Permissions: Full access' });
      expect(chip).toHaveAttribute('data-level', 'full');
    });
  });

  it('names SomeCode\'s deep research entry of the mode menu in the user\'s language, and shows it as the mode while it is on', async () => {
    const research = opt('mode', 'Mode', 'mode', 'default', ['default', 'plan', 'deep_research']);
    const { user, onChange, rerender } = setup({ options: [research, ...NO_EFFORT.filter((o) => o.id !== 'mode')] });
    await user.click(screen.getByRole('button', { name: 'Mode: default' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['default', 'plan', expect.stringContaining('Deep research')]);
    expect(within(screen.getByRole('menu')).getByText('Researches the question across many sources and writes a cited report.')).toBeInTheDocument();
    await user.click(items[2]!);
    expect(onChange).toHaveBeenCalledWith('mode', 'deep_research');
    rerender(<ConfigChips options={[{ ...research, currentValue: 'deep_research' }]} disabled={false} pendingId={null} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Mode: Deep research' })).toBeInTheDocument();
  });
});
