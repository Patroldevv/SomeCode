import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

// Infrastructure check: jsdom + Testing Library render (removed in Task 5 once real component tests exist).
it('renders into jsdom', () => {
  render(<p>merhaba</p>);
  expect(screen.getByText('merhaba')).toBeInTheDocument();
});
