import { describe, expect, it } from 'vitest';
import { localImagePath } from './localImage.ts';

describe('localImagePath', () => {
  it('takes an absolute picture path, plain or as a file: address', () => {
    expect(localImagePath('/home/me/.gemini/antigravity-cli/brain/abc/screenshot.png')).toBe('/home/me/.gemini/antigravity-cli/brain/abc/screenshot.png');
    expect(localImagePath('file:///home/me/my%20shot.JPG')).toBe('/home/me/my shot.JPG');
  });

  it('refuses everything else: web addresses, relative paths, other file types, tricks', () => {
    for (const bad of ['https://example.com/a.png', 'a.png', './a.png', '//host/a.png', '/etc/passwd', '/home/me/a.svg', '/home/me/../../etc/x.png', '/home/me/a.png\u0000', ' /home/me/a.png', 'data:image/png;base64,AAAA', '', 'file:///%E0%A4%A.png']) {
      expect(localImagePath(bad), bad).toBeNull();
    }
  });
});
