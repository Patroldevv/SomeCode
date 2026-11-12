#!/usr/bin/env node
// The tools SomeCode offers to the agents it runs, as a stdio MCP server: `scout` hands a reading/inspection job to
// Gemini. The agent calls it like any of its own tools, so it shows up as a real sub-agent in the interface.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { apiClient, registerHomeTools } from '../apps/server/src/agentTools/tools.ts';
import { parseBrowserMode } from '../apps/server/src/browser/guard.ts';
import { BrowserSession } from '../apps/server/src/browser/session.ts';
import { registerBrowserTools } from '../apps/server/src/browser/tools.ts';
import { createLedger } from '../apps/server/src/research/ledger.ts';
import { parseResearchConfig, registerResearchTools } from '../apps/server/src/research/tools.ts';

const url = process.env.SOMECODE_URL;
const token = process.env.SOMECODE_TOKEN;

const server = new McpServer({ name: 'somecode', version: '1.0.0' });

if (process.env.SOMECODE_SCOUT === '1') {
  server.registerTool(
    'scout',
    {
      title: 'Gemini Scout',
      description:
        'Hands a reading or inspection job to a fast Gemini sub-agent (very large context) and returns its factual report. ' +
        'Use it to read many files, map architecture, find where something is defined or analyse logs, before you answer or edit. ' +
        'It only reads: it cannot change files.',
      inputSchema: {
        task: z.string().min(1).describe('What to find out, in plain words (name the question, not the steps).'),
        files: z.array(z.string()).optional().describe('Files or folders it should read in depth, relative to the working directory.'),
      },
    },
    async ({ task, files }) => {
      if (!url || !token) return { isError: true, content: [{ type: 'text', text: 'SomeCode is not reachable from here (no address or token).' }] };
      try {
        const res = await fetch(`${url}/api/scout`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ task, cwd: process.cwd(), ...(files && files.length > 0 ? { files } : {}) }),
        });
        if (!res.ok) return { isError: true, content: [{ type: 'text', text: `The scout is not available (${res.status}). It may be switched off in the settings.` }] };
        const data = (await res.json()) as { ok: boolean; output: string; error?: string };
        return data.ok
          ? { content: [{ type: 'text', text: data.output || '(the scout returned nothing)' }] }
          : { isError: true, content: [{ type: 'text', text: `The scout failed: ${data.error ?? 'unknown error'}${data.output ? `\n\n${data.output}` : ''}` }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: `The scout could not be reached: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );
}

// Memory of past chats, project notes and scheduled tasks.
const toolset = new Set((process.env.SOMECODE_TOOLSET ?? 'history,memory,schedule,research,verify').split(','));
const api = apiClient({ url, token });
if (process.env.SOMECODE_TOOLS === '1') registerHomeTools(server, api, { sessionId: process.env.SOMECODE_SESSION_ID, cwd: process.cwd() }, toolset);

// The browser tools are only offered when they are switched on in the settings (SomeCode passes the mode).
const browserMode = parseBrowserMode(process.env.SOMECODE_BROWSER);
const browser = browserMode === 'off' ? null : new BrowserSession(browserMode);
if (browser) registerBrowserTools(server, browser);
// Deep research: the plan card, progress, a ledger of sources and (when any web address may be opened) web search.
if (process.env.SOMECODE_TOOLS === '1' && toolset.has('research')) {
  registerResearchTools(server, { call: api, sessionId: process.env.SOMECODE_SESSION_ID, ledger: createLedger(), config: parseResearchConfig(process.env.SOMECODE_RESEARCH), browser, browserMode });
}
// The hidden browser must not outlive the agent session that started it.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => (browser?.close(), process.exit(0)));
process.stdin.on('end', () => (browser?.close(), process.exit(0)));
process.on('exit', () => browser?.close());

await server.connect(new StdioServerTransport());
