import { Cdp } from './cdp.ts';
import { requestAllowed, urlAllowed, type BrowserMode } from './guard.ts';
import { findBrowser, launchBrowser, type LaunchedBrowser } from './launch.ts';

const SNAPSHOT_SCRIPT = `(() => {
  const sel = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemradio],[role=checkbox],[role=switch],[role=radio],[role=option],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  document.querySelectorAll('[data-sc-ref]').forEach((e) => e.removeAttribute('data-sc-ref'));
  let n = 0; const rows = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.bottom < -200 || r.top > innerHeight * 3) continue;
    n++; el.setAttribute('data-sc-ref', String(n));
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.alt || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    const extra = [
      el.type && !['submit', 'button'].includes(el.type) ? 'type=' + el.type : '',
      el.disabled ? 'disabled' : '', el.checked ? 'checked' : '',
      el.getAttribute('aria-pressed') === 'true' ? 'pressed' : '', el.getAttribute('aria-selected') === 'true' ? 'selected' : '',
      el.getAttribute('aria-expanded') ? 'expanded=' + el.getAttribute('aria-expanded') : '',
      el.getAttribute('href') ? 'href=' + el.getAttribute('href').slice(0, 60) : '',
      el.value && el.tagName !== 'BUTTON' ? 'value="' + String(el.value).slice(0, 30) + '"' : '',
    ].filter(Boolean).join(' ');
    rows.push('[' + n + '] ' + role + ' "' + name + '"' + (extra ? ' ' + extra : ''));
    if (n >= 150) break;
  }
  const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 12).map((h) => h.innerText.trim().slice(0, 80)).filter(Boolean);
  return JSON.stringify({ url: location.href, title: document.title, headings, elements: rows, text: document.body ? document.body.innerText.replace(/\\n{3,}/g, '\\n\\n').slice(0, 3000) : '' });
})()`;

const KEYS: Record<string, { key: string; code: string; vk: number }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Space: { key: ' ', code: 'Space', vk: 32 },
};
const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };

export type Target = { ref?: number; selector?: string; x?: number; y?: number };
export type Snapshot = { url: string; title: string; headings: string[]; elements: string[]; text: string };

const MAX_LOG = 150;

/** One hidden browser page an agent drives: open, look (screenshot / snapshot), click, type, read the console. */
export class BrowserSession {
  readonly #mode: BrowserMode;
  #launched: LaunchedBrowser | null = null;
  #cdp: Cdp | null = null;
  #starting: Promise<Cdp> | null = null;
  readonly #console: string[] = [];
  readonly #failures: string[] = [];

  constructor(mode: BrowserMode) {
    this.#mode = mode;
  }

  get mode(): BrowserMode {
    return this.#mode;
  }

  async #page(): Promise<Cdp> {
    if (this.#cdp && !this.#cdp.closed) return this.#cdp;
    this.#starting ??= this.#start().finally(() => (this.#starting = null));
    return this.#starting;
  }

  async #start(): Promise<Cdp> {
    const choice = findBrowser();
    if (!choice) throw new Error('no browser found: install Chromium or Google Chrome (or Electron) to use the browser tools');
    this.#launched = await launchBrowser(choice);
    const cdp = await Cdp.connect(this.#launched.pageUrl);
    cdp.on('Runtime.consoleAPICalled', (p) => this.#log(this.#console, `${p.type}: ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? a.type).join(' ')}`.slice(0, 400)));
    cdp.on('Runtime.exceptionThrown', (p) => this.#log(this.#console, `exception: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'error'}`.slice(0, 600)));
    cdp.on('Log.entryAdded', (p) => this.#log(this.#console, `${p.entry.level}: ${p.entry.text}`.slice(0, 400)));
    cdp.on('Network.loadingFailed', (p) => this.#log(this.#failures, `${p.errorText ?? 'failed'}${p.blockedReason ? ` (${p.blockedReason})` : ''} ${p.requestId}`));
    cdp.on('Network.responseReceived', (p) => {
      if (p.response.status >= 400) this.#log(this.#failures, `${p.response.status} ${p.response.url}`.slice(0, 300));
    });
    // Everything the page asks for goes through the same guard as the addresses the agent opens.
    cdp.on('Fetch.requestPaused', (p) => {
      const method = requestAllowed(p.request.url, this.#mode) ? 'Fetch.continueRequest' : 'Fetch.failRequest';
      void cdp.send(method, method === 'Fetch.failRequest' ? { requestId: p.requestId, errorReason: 'BlockedByClient' } : { requestId: p.requestId }).catch(() => {});
      if (method === 'Fetch.failRequest') this.#log(this.#failures, `blocked ${p.request.url}`.slice(0, 300));
    });
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Log.enable'), cdp.send('Network.enable'), cdp.send('DOM.enable')]);
    // A hidden page must still draw frames, or screenshots hang.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await cdp.send('Page.bringToFront').catch(() => {});
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    this.#cdp = cdp;
    return cdp;
  }

  #log(list: string[], line: string): void {
    if (line.includes('Electron Security Warning')) return;
    list.push(line);
    if (list.length > MAX_LOG) list.shift();
  }

  async #eval<T = unknown>(expression: string): Promise<T> {
    const cdp = await this.#page();
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'script error');
    return res.result.value as T;
  }

  async open(raw: string): Promise<{ url: string; title: string }> {
    const check = urlAllowed(raw, this.#mode);
    if (!check.ok) throw new Error(check.reason);
    const cdp = await this.#page();
    const loaded = cdp.once('Page.loadEventFired', 20_000).catch(() => null);
    const nav = await cdp.send('Page.navigate', { url: check.url });
    if (nav.errorText) throw new Error(`could not open ${check.url}: ${nav.errorText}`);
    await loaded;
    return { url: await this.#eval<string>('location.href'), title: await this.#eval<string>('document.title') };
  }

  /** Where the browser is now (the address and the title). */
  async pageInfo(): Promise<{ url: string; title: string }> {
    return { url: await this.#eval<string>('location.href'), title: await this.#eval<string>('document.title') };
  }

  /** A JPEG of what the page shows (or of the whole page), as base64. */
  async screenshot(fullPage = false): Promise<{ data: string; mimeType: 'image/jpeg' }> {
    const cdp = await this.#page();
    const params: Record<string, unknown> = { format: 'jpeg', quality: 72 };
    if (fullPage) {
      const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
      params['captureBeyondViewport'] = true;
      params['clip'] = { x: 0, y: 0, width: Math.min(cssContentSize.width, 2000), height: Math.min(cssContentSize.height, 6000), scale: 1 };
    }
    const { data } = await cdp.send('Page.captureScreenshot', params);
    return { data, mimeType: 'image/jpeg' };
  }

  async snapshot(): Promise<Snapshot> {
    return JSON.parse(await this.#eval<string>(SNAPSHOT_SCRIPT)) as Snapshot;
  }

  /** The centre of the target in page coordinates, scrolled into view. */
  async #centre(target: Target): Promise<{ x: number; y: number }> {
    if (target.x !== undefined && target.y !== undefined) return { x: target.x, y: target.y };
    const selector = target.ref !== undefined ? `[data-sc-ref="${Number(target.ref)}"]` : target.selector;
    if (!selector) throw new Error('say what to use: a ref from the snapshot, a CSS selector, or x and y');
    const box = await this.#eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(target.ref !== undefined ? `nothing with ref ${target.ref}: take a new snapshot (the page may have changed)` : `no element matches ${selector}`);
    return box;
  }

  async click(target: Target, double = false): Promise<void> {
    const { x, y } = await this.#centre(target);
    const cdp = await this.#page();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const clickCount of double ? [1, 2] : [1]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    }
  }

  async type(target: Target, text: string, options: { submit?: boolean; clear?: boolean } = {}): Promise<void> {
    await this.click(target);
    if (options.clear !== false) await this.#eval(`(() => { const el = document.activeElement; if (el && el.select) el.select(); else if (el && el.isContentEditable) document.execCommand('selectAll'); })()`);
    const cdp = await this.#page();
    if (text === '') await this.press('Backspace');
    else await cdp.send('Input.insertText', { text });
    if (options.submit) await this.press('Enter');
  }

  /** One key or a combination such as "Control+K" or "Shift+Tab". */
  async press(combo: string): Promise<void> {
    const parts = combo.split('+');
    const name = parts.pop() ?? '';
    let modifiers = 0;
    for (const m of parts) {
      if (!(m in MODIFIERS)) throw new Error(`unknown modifier ${m}`);
      modifiers |= MODIFIERS[m]!;
    }
    const known = KEYS[name] ?? (name.length === 1 ? { key: name, code: /[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : '', vk: name.toUpperCase().charCodeAt(0) } : null);
    if (!known) throw new Error(`unknown key ${name}`);
    const cdp = await this.#page();
    const base = { modifiers, key: known.key, code: known.code, windowsVirtualKeyCode: known.vk, nativeVirtualKeyCode: known.vk };
    const text = modifiers & 6 ? undefined : known.key.length === 1 ? known.key : known.key === 'Enter' ? '\r' : undefined;
    await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async scroll(deltaY: number): Promise<void> {
    await this.#eval(`window.scrollBy(0, ${Number(deltaY) || 0})`);
  }

  async evaluate(expression: string, limit = 8000): Promise<string> {
    const value = await this.#eval(expression);
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined';
    return text.length > limit ? `${text.slice(0, limit)}\n… (cut)` : text;
  }

  async resize(width: number, height: number): Promise<void> {
    const cdp = await this.#page();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.min(Math.max(Math.round(width), 200), 3000), height: Math.min(Math.max(Math.round(height), 200), 3000), deviceScaleFactor: 1, mobile: width < 600 });
  }

  /** Waits until the text shows up on the page (or the selector matches), or the time runs out. */
  async waitFor(options: { text?: string; selector?: string; ms?: number }): Promise<boolean> {
    if (options.text === undefined && options.selector === undefined) {
      await new Promise((r) => setTimeout(r, Math.min(options.ms ?? 1000, 15_000)));
      return true;
    }
    const deadline = Date.now() + Math.min(options.ms ?? 10_000, 30_000);
    const check = `(() => ${options.selector !== undefined ? `!!document.querySelector(${JSON.stringify(options.selector)})` : `document.body && document.body.innerText.includes(${JSON.stringify(options.text)})`})()`;
    while (Date.now() < deadline) {
      if (await this.#eval<boolean>(check)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  consoleLog(clear = false): string[] {
    return clear ? this.#console.splice(0) : [...this.#console];
  }

  failedRequests(clear = false): string[] {
    return clear ? this.#failures.splice(0) : [...this.#failures];
  }

  close(): void {
    this.#cdp?.close();
    this.#cdp = null;
    this.#launched?.close();
    this.#launched = null;
  }
}
