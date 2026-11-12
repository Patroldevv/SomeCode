import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findBrowser } from './launch.ts';
import { BrowserSession } from './session.ts';

const PAGE = `<!doctype html><title>Try</title><h1>Hello page</h1>
<button id="b" onclick="document.getElementById('out').textContent='clicked'">Press me</button>
<input id="name" placeholder="Your name"><p id="out">idle</p>
<script>console.error('boom on purpose'); fetch('/missing').catch(()=>{});</script>`;

// Needs a browser on this computer (Chromium, Chrome or Electron): skipped where there is none.
describe.skipIf(!findBrowser())('BrowserSession (real browser)', () => {
  let server: Server;
  let base = '';
  const session = new BrowserSession('local');

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/') res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
      else res.writeHead(404).end('no');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }, 60_000);

  afterAll(async () => {
    session.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('opens a local page, lists its elements, clicks one by ref and types into a field', async () => {
    expect(await session.open(base)).toMatchObject({ title: 'Try' });
    const snap = await session.snapshot();
    expect(snap.headings).toContain('Hello page');
    const button = snap.elements.find((e) => e.includes('"Press me"'))!;
    const field = snap.elements.find((e) => e.includes('"Your name"'))!;
    expect(button).toBeDefined();
    await session.click({ ref: Number(/^\[(\d+)\]/.exec(button)![1]) });
    // A click is handled by the page a moment after it is dispatched (longer when the machine is busy).
    expect(await session.waitFor({ text: 'clicked', ms: 8000 })).toBe(true);
    expect(await session.evaluate("document.getElementById('out').textContent")).toBe('clicked');
    await session.type({ ref: Number(/^\[(\d+)\]/.exec(field)![1]) }, 'Ada', {});
    expect(await session.evaluate("document.getElementById('name').value")).toBe('Ada');
  }, 90_000);

  it('takes a screenshot (a JPEG), reads the console and failed requests, and waits for text', async () => {
    const shot = await session.screenshot();
    expect(shot.mimeType).toBe('image/jpeg');
    expect(Buffer.from(shot.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(session.consoleLog().join('\n')).toContain('boom on purpose');
    expect(session.failedRequests().join('\n')).toContain('/missing');
    expect(await session.waitFor({ text: 'clicked', ms: 2000 })).toBe(true);
    expect(await session.waitFor({ text: 'never there', ms: 400 })).toBe(false);
  }, 90_000);

  it('refuses addresses outside this computer, and blocks what the page loads from elsewhere', async () => {
    await expect(session.open('https://example.com/')).rejects.toThrow(/this computer/);
    await session.evaluate(`(() => { const i = new Image(); i.src = 'https://example.com/x.png'; return 1; })()`);
    await session.waitFor({ ms: 500 });
    expect(session.failedRequests().join('\n')).toContain('blocked https://example.com/x.png');
  }, 90_000);

  it('says what is wrong for a ref that no longer exists', async () => {
    await expect(session.click({ ref: 9999 })).rejects.toThrow(/take a new snapshot/);
  }, 60_000);
});
