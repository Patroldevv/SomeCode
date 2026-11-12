import { beforeEach, describe, expect, it } from 'vitest';
import { resetTranscriptViewsForTests, sessionViewOverride, setSessionView } from './transcriptView.ts';

beforeEach(() => resetTranscriptViewsForTests());

describe('transcript view per session', () => {
  it('remembers a view for one session only and forgets it on null', () => {
    expect(sessionViewOverride('a')).toBeNull();
    setSessionView('a', 'detailed');
    expect(sessionViewOverride('a')).toBe('detailed');
    expect(sessionViewOverride('b')).toBeNull();
    setSessionView('a', null);
    expect(sessionViewOverride('a')).toBeNull();
  });
});
