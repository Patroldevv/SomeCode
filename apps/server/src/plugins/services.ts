import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SomeCodeError } from '@somecode/protocol';
import type { Run } from './catalog.ts';

/** A remote service an agent can be connected to (an MCP server), as offered in the catalogue. */
export type ServiceInfo = {
  /** The name it is connected under. */
  id: string;
  name: string;
  description: string;
  url: string;
  transport: 'http' | 'sse';
  /** GitHub account whose avatar is used as the logo. */
  owner?: string;
  category: string;
  /** The service also takes an access token (an API key); without one it asks for a sign-in on first use. */
  token?: 'optional';
  connected: boolean;
  /** A connected server that is not in the catalogue (the user added it). */
  custom?: boolean;
};

type Entry = Omit<ServiceInfo, 'connected' | 'custom'>;

/**
 * Well-known services that run an MCP server of their own. Connecting one only tells Claude where it is; the
 * service itself asks for a sign-in the first time the agent uses it.
 */
export const SERVICE_CATALOGUE: readonly Entry[] = [
  { id: 'github', name: 'GitHub', description: 'Triage pull requests and issues, read code, run CI checks', url: 'https://api.githubcopilot.com/mcp/', transport: 'http', owner: 'github', category: 'development' },
  { id: 'supabase', name: 'Supabase', description: 'Manage and query your databases, projects and edge functions', url: 'https://mcp.supabase.com/mcp', transport: 'http', owner: 'supabase', category: 'database' },
  { id: 'notion', name: 'Notion', description: 'Search, read and update pages and databases in your workspace', url: 'https://mcp.notion.com/mcp', transport: 'http', owner: 'makenotion', category: 'productivity' },
  { id: 'linear', name: 'Linear', description: 'Find, create and update issues and projects', url: 'https://mcp.linear.app/mcp', transport: 'http', owner: 'linear', category: 'productivity' },
  { id: 'sentry', name: 'Sentry', description: 'Look into errors and performance problems of your apps', url: 'https://mcp.sentry.dev/mcp', transport: 'http', owner: 'getsentry', category: 'monitoring' },
  { id: 'asana', name: 'Asana', description: 'Work with tasks, projects and goals', url: 'https://mcp.asana.com/sse', transport: 'sse', owner: 'Asana', category: 'productivity' },
  { id: 'atlassian', name: 'Atlassian', description: 'Jira issues and Confluence pages', url: 'https://mcp.atlassian.com/v1/sse', transport: 'sse', owner: 'atlassian', category: 'productivity' },
  { id: 'context7', name: 'Context7', description: 'Up-to-date documentation and code examples for libraries', url: 'https://mcp.context7.com/mcp', transport: 'http', owner: 'upstash', category: 'development' },
  { id: 'stripe', name: 'Stripe', description: 'Payments, customers and subscriptions', url: 'https://mcp.stripe.com', transport: 'http', owner: 'stripe', category: 'business' },
  { id: 'vercel', name: 'Vercel', description: 'Projects, deployments and logs', url: 'https://mcp.vercel.com', transport: 'http', owner: 'vercel', category: 'deployment' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', description: 'Search the Cloudflare documentation', url: 'https://docs.mcp.cloudflare.com/mcp', transport: 'http', owner: 'cloudflare', category: 'development' },
  { id: 'huggingface', name: 'Hugging Face', description: 'Search models, datasets and papers', url: 'https://huggingface.co/mcp', transport: 'http', owner: 'huggingface', category: 'ai', token: 'optional' },
  { id: 'figma', name: 'Figma', description: 'Read designs, components and variables', url: 'https://mcp.figma.com/mcp', transport: 'http', owner: 'figma', category: 'design' },
  { id: 'canva', name: 'Canva', description: 'Create and edit designs', url: 'https://mcp.canva.com/mcp', transport: 'http', owner: 'canva', category: 'design' },
  { id: 'slack', name: 'Slack', description: 'Search and read channels and messages', url: 'https://mcp.slack.com/mcp', transport: 'http', owner: 'slackapi', category: 'productivity' },
  { id: 'monday', name: 'monday.com', description: 'Boards, items and updates', url: 'https://mcp.monday.com/mcp', transport: 'http', owner: 'mondaycom', category: 'productivity' },
  { id: 'intercom', name: 'Intercom', description: 'Conversations and contacts', url: 'https://mcp.intercom.com/mcp', transport: 'http', owner: 'intercom', category: 'business' },
  { id: 'paypal', name: 'PayPal', description: 'Invoices, orders and transactions', url: 'https://mcp.paypal.com/mcp', transport: 'http', owner: 'paypal', category: 'business' },
  { id: 'square', name: 'Square', description: 'Payments, catalogue and customers', url: 'https://mcp.squareup.com/sse', transport: 'sse', owner: 'square', category: 'business' },
  { id: 'plaid', name: 'Plaid', description: 'Look into your Plaid integration', url: 'https://api.dashboard.plaid.com/mcp/sse', transport: 'sse', owner: 'plaid', category: 'business' },
  { id: 'neon', name: 'Neon', description: 'Postgres projects, branches and queries', url: 'https://mcp.neon.tech/mcp', transport: 'http', owner: 'neondatabase', category: 'database', token: 'optional' },
  { id: 'prisma', name: 'Prisma', description: 'Manage Prisma Postgres databases', url: 'https://mcp.prisma.io/mcp', transport: 'http', owner: 'prisma', category: 'database' },
  { id: 'clerk', name: 'Clerk', description: 'Authentication snippets and SDK guidance', url: 'https://mcp.clerk.com/mcp', transport: 'http', owner: 'clerk', category: 'development' },
  { id: 'netlify', name: 'Netlify', description: 'Sites, deploys and environment variables', url: 'https://netlify-mcp.netlify.app/mcp', transport: 'http', owner: 'netlify', category: 'deployment' },
  { id: 'cloudflare-bindings', name: 'Cloudflare Bindings', description: 'Workers, KV, R2 and D1', url: 'https://bindings.mcp.cloudflare.com/mcp', transport: 'http', owner: 'cloudflare', category: 'deployment' },
  { id: 'posthog', name: 'PostHog', description: 'Product analytics, flags and experiments', url: 'https://mcp.posthog.com/mcp', transport: 'http', owner: 'PostHog', category: 'monitoring', token: 'optional' },
  { id: 'semgrep', name: 'Semgrep', description: 'Scan code for security problems', url: 'https://mcp.semgrep.ai/mcp', transport: 'http', owner: 'semgrep', category: 'security' },
  { id: 'postman', name: 'Postman', description: 'Collections, requests and API specs', url: 'https://mcp.postman.com/mcp', transport: 'http', owner: 'postmanlabs', category: 'development', token: 'optional' },
  { id: 'webflow', name: 'Webflow', description: 'Sites, CMS and pages', url: 'https://mcp.webflow.com/mcp', transport: 'http', owner: 'webflow', category: 'design' },
  { id: 'wix', name: 'Wix', description: 'Build and manage Wix sites', url: 'https://mcp.wix.com/mcp', transport: 'http', owner: 'wix', category: 'design' },
  { id: 'sanity', name: 'Sanity', description: 'Content and schemas of your studio', url: 'https://mcp.sanity.io', transport: 'http', owner: 'sanity-io', category: 'development' },
  { id: 'exa', name: 'Exa', description: 'Web search built for agents', url: 'https://mcp.exa.ai/mcp', transport: 'http', owner: 'exa-labs', category: 'ai', token: 'optional' },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SERVICE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The MCP servers Claude has in the user's own config, by name. */
async function connectedServers(home: string): Promise<Map<string, { url?: string; transport?: string }>> {
  try {
    const config = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')) as unknown;
    const servers = isRecord(config) && isRecord(config['mcpServers']) ? config['mcpServers'] : {};
    return new Map(
      Object.entries(servers).map(([name, s]) => [
        name,
        { ...(isRecord(s) && typeof s['url'] === 'string' ? { url: s['url'] } : {}), ...(isRecord(s) && typeof s['type'] === 'string' ? { transport: s['type'] } : {}) },
      ]),
    );
  } catch {
    return new Map();
  }
}

/** The catalogue with what is connected, then any other server the user connected themselves. */
export async function listServices(home: string): Promise<ServiceInfo[]> {
  const connected = await connectedServers(home);
  const out: ServiceInfo[] = SERVICE_CATALOGUE.map((s) => ({ ...s, connected: connected.has(s.id) }));
  for (const [name, info] of connected) {
    if (SERVICE_CATALOGUE.some((s) => s.id === name)) continue;
    out.push({ id: name, name, description: info.url ?? '', url: info.url ?? '', transport: info.transport === 'sse' ? 'sse' : 'http', category: 'custom', connected: true, custom: true });
  }
  return out;
}

/** Only a public https address, with no sign-in details in it, can be connected. */
function checkUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SomeCodeError('bad_request', 'give the address of the service (https)');
  }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) {
    throw new SomeCodeError('bad_request', 'give the address of the service (https)');
  }
  return url.toString();
}

/** An access token goes into one `Authorization: Bearer` header; whitespace or control characters could smuggle in more. */
const TOKEN_CHARS = /^[\x21-\x7e]{8,500}$/;

export async function connectService(run: Run, input: { name: string; url: string; transport: string; token?: string }): Promise<void> {
  if (!SERVICE_NAME.test(input.name)) throw new SomeCodeError('bad_request', 'a name is lowercase letters, digits and dashes');
  if (input.transport !== 'http' && input.transport !== 'sse') throw new SomeCodeError('bad_request', 'transport must be http or sse');
  const url = checkUrl(input.url);
  const token = input.token?.trim();
  if (token && !TOKEN_CHARS.test(token)) throw new SomeCodeError('bad_request', 'that access token does not look right');
  try {
    await run('claude', ['mcp', 'add', '--transport', input.transport, '-s', 'user', input.name, url, ...(token ? ['--header', `Authorization: Bearer ${token}`] : [])], 60_000);
  } catch (err) {
    // The message may echo the command line, so the token is scrubbed from it.
    const message = (err instanceof Error ? err.message.split('\n')[0]! : String(err)).replaceAll(token ?? '\0', '***');
    throw new SomeCodeError('internal', `claude mcp add failed: ${message}`);
  }
}

export async function disconnectService(run: Run, name: string): Promise<void> {
  if (!SERVICE_NAME.test(name)) throw new SomeCodeError('bad_request', 'a name is lowercase letters, digits and dashes');
  try {
    await run('claude', ['mcp', 'remove', '-s', 'user', name], 60_000);
  } catch (err) {
    throw new SomeCodeError('internal', `claude mcp remove failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
}
