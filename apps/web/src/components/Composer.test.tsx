import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { Composer } from './Composer.tsx';

beforeAll(() => setLanguageForTests('en'));
afterEach(() => vi.restoreAllMocks());

type Props = Partial<React.ComponentProps<typeof Composer>>;

/** Fully controlled host; like the real parent it clears the draft in `onSend`. */
function Host({ initial = '', clearOnSend = true, onSend, ...rest }: Props & { initial?: string; clearOnSend?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      value={value}
      onChange={setValue}
      running={false}
      disabled={false}
      onSend={(text) => {
        onSend?.(text);
        if (clearOnSend) setValue('');
      }}
      onCancel={() => {}}
      {...rest}
    />
  );
}

const box = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;

describe('Composer', () => {
  it('Enter sends the trimmed text once', async () => {
    const onSend = vi.fn();
    render(<Host onSend={onSend} />);
    await userEvent.type(box(), '  hello world  {Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello world');
    expect(box().value).toBe('');
  });

  it('Send button sends the trimmed text', async () => {
    const onSend = vi.fn();
    render(<Host initial=" hi " onSend={onSend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('hi');
    expect(box()).toHaveFocus();
  });

  it('Shift+Enter inserts a newline and does not send', async () => {
    const onSend = vi.fn();
    render(<Host onSend={onSend} />);
    await userEvent.type(box(), 'a{Shift>}{Enter}{/Shift}b');
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe('a\nb');
  });

  it('Shift+Enter is not default-prevented', () => {
    render(<Host initial="a" />);
    expect(fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })).toBe(true);
  });

  it('Enter while IME composing does not send', () => {
    const onSend = vi.fn();
    render(<Host initial="にほん" onSend={onSend} />);
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('whitespace-only is not sent and the send button is disabled', async () => {
    const onSend = vi.fn();
    render(<Host onSend={onSend} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(box(), '   {Enter}');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe('   ');
  });

  it('while running Enter does not send and the stop button calls onCancel', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(<Host initial="next" running onSend={onSend} onCancel={onCancel} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toHaveAttribute('type', 'button');
    await userEvent.click(stop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('the textarea stays editable while running', async () => {
    render(<Host running />);
    await userEvent.type(box(), 'queued');
    expect(box().value).toBe('queued');
  });

  it('plain Enter while running does not insert a newline', () => {
    render(<Host initial="next" running />);
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(false);
    expect(box().value).toBe('next');
  });

  it('plain Enter on empty text does not insert a newline', () => {
    render(<Host />);
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(false);
  });

  it('Ctrl+Enter and Meta+Enter also send; Alt+Enter does not', () => {
    const onSend = vi.fn();
    render(<Host initial="go" clearOnSend={false} onSend={onSend} />);
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Meta+Enter sends', () => {
    const onSend = vi.fn();
    render(<Host initial="go" onSend={onSend} />);
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledExactlyOnceWith('go');
  });

  it('Alt+Enter does not send', () => {
    const onSend = vi.fn();
    render(<Host initial="go" onSend={onSend} />);
    fireEvent.keyDown(box(), { key: 'Enter', altKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disabled blocks everything', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(<Host initial="text" disabled onSend={onSend} onCancel={onCancel} />);
    expect(box()).toBeDisabled();
    expect(box()).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disabled while running still blocks the keyboard', () => {
    const onSend = vi.fn();
    render(<Host initial="text" disabled running onSend={onSend} />);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('focuses the textarea on mount and keeps focus after a send', async () => {
    render(<Host />);
    expect(box()).toHaveFocus();
    await userEvent.type(box(), 'x{Enter}');
    expect(box()).toHaveFocus();
  });

  it('does not send twice on a rapid double Enter before the parent clears the draft', () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <Composer value="hi" onChange={() => {}} running={false} disabled={false} onSend={onSend} onCancel={() => {}} />,
    );
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    // the draft changes (cleared, then typed again) -> the guard is released
    rerender(<Composer value="" onChange={() => {}} running={false} disabled={false} onSend={onSend} onCancel={() => {}} />);
    rerender(<Composer value="again" onChange={() => {}} running={false} disabled={false} onSend={onSend} onCancel={() => {}} />);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('the textarea grows with content but is capped', () => {
    let scrollHeight = 24;
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    const props = { onChange: () => {}, running: false, disabled: false, onSend: () => {}, onCancel: () => {} };
    const { rerender } = render(<Composer value="" {...props} />);
    expect(box().style.height).toBe('24px');
    scrollHeight = 100;
    rerender(<Composer value={'a\n'.repeat(4)} {...props} />);
    expect(box().style.height).toBe('100px');
    expect(box().style.overflowY).toBe('hidden');
    scrollHeight = 1000;
    rerender(<Composer value={'a\n'.repeat(40)} {...props} />);
    expect(box().style.height).toBe('288px'); // 12 lines x 24px fallback
    expect(box().style.maxHeight).toBe('288px');
    expect(box().style.overflowY).toBe('auto');
    scrollHeight = 24;
    rerender(<Composer value="" {...props} />);
    expect(box().style.height).toBe('24px');
  });

  describe('double-send guard is self-healing', () => {
    const base = { onChange: () => {}, running: false, disabled: false, onCancel: () => {} };

    it('a throwing onSend does not block a later resend of the same text', () => {
      const onSend = vi.fn(() => {
        throw new Error('ws closed');
      });
      render(<Composer value="hi" {...base} onSend={onSend} />);
      // React reports handler errors to window; silence the jsdom noise.
      const swallow = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener('error', swallow);
      fireEvent.keyDown(box(), { key: 'Enter' });
      fireEvent.keyDown(box(), { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      window.removeEventListener('error', swallow);
      expect(onSend).toHaveBeenCalledTimes(3);
    });

    it('running true -> false with an unchanged draft allows a resend', () => {
      const onSend = vi.fn();
      const { rerender } = render(<Composer value="hi" {...base} onSend={onSend} />);
      fireEvent.keyDown(box(), { key: 'Enter' });
      rerender(<Composer value="hi" {...base} running onSend={onSend} />);
      rerender(<Composer value="hi" {...base} onSend={onSend} />);
      fireEvent.keyDown(box(), { key: 'Enter' });
      expect(onSend).toHaveBeenCalledTimes(2);
    });

    it('a parent that keeps the draft can resend after one tick (guard only covers the same tick)', async () => {
      const onSend = vi.fn();
      render(<Composer value="hi" {...base} onSend={onSend} />);
      fireEvent.keyDown(box(), { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 0));
      fireEvent.keyDown(box(), { key: 'Enter' });
      expect(onSend).toHaveBeenCalledTimes(2);
    });
  });

  it('moves focus to the textarea after Stop is clicked', async () => {
    const onCancel = vi.fn();
    render(<Host running onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(box()).toHaveFocus();
  });
});
