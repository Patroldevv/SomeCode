import { describe, expect, it } from 'vitest';
import { blockedHost, formatSiteReport, isPrivateAddress, summarizeHeaders } from './site.ts';

describe('site inspection helpers', () => {
  it('knows which addresses are on this computer or a private network', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '169.254.1.1', '::1', 'fd00::1', '100.64.0.1']) expect(isPrivateAddress(a)).toBe(true);
    for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(a)).toBe(false);
  });

  it('refuses local names and private addresses without asking the network', async () => {
    expect(await blockedHost('localhost')).toMatch(/local/);
    expect(await blockedHost('app.localhost')).toMatch(/local/);
    expect(await blockedHost('192.168.1.5')).toMatch(/private/);
    expect(await blockedHost('8.8.8.8')).toBeNull();
  });

  it('keeps the telling headers, shows cookies without their values and lists missing security headers', () => {
    const headers = new Headers({ server: 'cloudflare', 'cf-ray': 'abc', 'x-content-type-options': 'nosniff', 'content-type': 'text/html' });
    headers.append('set-cookie', 'session=SECRET123; Path=/; Secure; HttpOnly; SameSite=Lax');
    headers.append('set-cookie', 'theme=dark');
    const facts = summarizeHeaders(200, 'https://example.com/', headers);
    expect(facts.headers.map(([k]) => k)).toEqual(expect.arrayContaining(['server', 'cf-ray', 'content-type']));
    expect(facts.cookies).toEqual(['session (secure, httponly, samesite)', 'theme (no flags)']);
    expect(JSON.stringify(facts)).not.toContain('SECRET123');
    expect(facts.missingSecurity).toEqual(['strict-transport-security', 'content-security-policy', 'referrer-policy']);
  });

  it('writes one report out of what was gathered, and says what could not be', () => {
    const report = formatSiteReport({
      origin: 'https://example.com',
      http: { status: 200, url: 'https://example.com/', headers: [['server', 'nginx']], cookies: [], missingSecurity: ['content-security-policy'] },
      dns: { A: ['93.184.216.34'], AAAA: [], CNAME: [], NS: ['a.iana-servers.net'], MX: [], TXT: [] },
      page: { url: 'https://example.com/', title: 'Example', generator: '', description: '', lang: 'en', charset: 'UTF-8', manifest: '', canonical: '', tech: ['React'], thirdParty: [['cdn.example.net', 4]], apis: ['example.com/api/items'], scripts: ['https://example.com/app.js'], styles: [], cookieNames: [], forms: 1, links: 12, images: 3, serviceWorker: true },
      robots: 'User-agent: *',
      sitemap: false,
      security: null,
    });
    for (const needle of ['SITE INSPECTION of https://example.com', 'server: nginx', 'A: 93.184.216.34', 'detected: React', 'cdn.example.net (4)', 'example.com/api/items', 'sitemap.xml: not found', 'security.txt: unknown']) expect(report).toContain(needle);
    expect(formatSiteReport({ origin: 'https://x.test', http: null, httpError: 'timeout', dns: null, page: null, pageError: 'no browser', robots: null, sitemap: null, security: null })).toContain('could not fetch (timeout)');
  });
});
