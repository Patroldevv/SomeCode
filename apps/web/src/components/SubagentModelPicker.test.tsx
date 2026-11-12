import type { ConfigOption } from '@somecode/protocol';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { SubagentModelPicker } from './SubagentModelPicker.tsx';

beforeAll(() => setLanguageForTests('en'));

const options: ConfigOption[] = [
  { id: 'model', name: 'Model', category: 'model', currentValue: 'flash', choices: [{ value: 'flash', name: 'Gemini Flash' }, { value: 'pro', name: 'Gemini Pro' }] },
  { id: 'effort', name: 'Effort', category: 'thought_level', currentValue: 'medium', choices: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
];

describe('SubagentModelPicker', () => {
  it('shows the saved model and effort from what the agent really offers and reports a change', async () => {
    const onChange = vi.fn();
    render(<SubagentModelPicker agentId="agy" model="pro" effort="high" disabled={false} loadOptions={async () => options} onChange={onChange} />);
    const trigger = await screen.findByRole('button', { name: /Gemini Pro/ });
    expect(trigger).toHaveTextContent('High');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to the agent\'s own value for a saved one it does not know, and picks a model from the list', async () => {
    const onChange = vi.fn();
    render(<SubagentModelPicker agentId="agy" model="gone" effort="default" disabled={false} loadOptions={async () => options} onChange={onChange} />);
    const trigger = await screen.findByRole('button', { name: /Gemini Flash/ });
    expect(trigger).toHaveTextContent('Medium');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByText('Gemini Flash', { selector: '.picker-model-link span' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Gemini Pro/ }));
    expect(onChange).toHaveBeenCalledWith({ model: 'pro' });
  });

  it('says so, and can ask again, when the agent lists no models', async () => {
    const load = vi.fn(async () => [] as ConfigOption[]);
    render(<SubagentModelPicker agentId="agy" model={undefined} effort={undefined} disabled={false} loadOptions={load} onChange={() => {}} />);
    expect(await screen.findByText('The agent did not list its models.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh agents' }));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
