import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { ResearchWork } from '../lib/researchSources.ts';
import { ResearchFollowUps } from './ResearchFollowUps.tsx';
import { SourcesView } from './SourcesView.tsx';

beforeEach(() => setLanguageForTests('en'));

const work: ResearchWork = {
  sources: [
    { url: 'https://quickshell.org/docs', title: 'Quickshell documentation', finding: 'QML based toolkit.', confidence: 'high', step: 1 },
    { url: 'javascript:alert(1)', title: 'Bad address', finding: 'x', confidence: 'low' },
  ],
  read: [{ url: 'https://other.example/page', running: true }],
  searches: [{ query: 'quickshell hyprland', engine: 'Bing', running: false }],
  busy: true,
};

describe('SourcesView', () => {
  it('lists sources with their confidence, links safe addresses only, and shows pages read and searches', () => {
    render(<SourcesView work={work} />);
    expect(screen.getByText('1 high confidence · 3 pages · 1 searches')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Quickshell documentation' });
    expect(link).toHaveAttribute('href', 'https://quickshell.org/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.queryByRole('link', { name: 'Bad address' })).not.toBeInTheDocument();
    expect(screen.getByText('Bad address')).toBeInTheDocument();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Researching' })).toBeInTheDocument();
    expect(within(screen.getByText('Pages read').closest('section')!).getByRole('link')).toHaveAttribute('href', 'https://other.example/page');
    expect(screen.getByText('quickshell hyprland')).toBeInTheDocument();
  });

  it('says what will appear while there is nothing yet', () => {
    render(<SourcesView work={{ sources: [], read: [], searches: [], busy: false }} />);
    expect(screen.getByText(/appear here as the research notes/)).toBeInTheDocument();
  });
});

describe('ResearchFollowUps', () => {
  it('sends the prompt of the pressed follow-up', async () => {
    const picked: string[] = [];
    render(<ResearchFollowUps onPick={(text) => picked.push(text)} />);
    screen.getByRole('button', { name: 'Turn into a table' }).click();
    expect(picked[0]).toMatch(/comparison tables/);
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });
});
