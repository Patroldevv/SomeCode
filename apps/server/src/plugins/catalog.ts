import { githubOwnerOf } from './icons.ts';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { SomeCodeError } from '@somecode/protocol';

/** An agent that can hold skills, and the folder it reads them from. */
export type SkillAgent = 'claude' | 'agy';
export const SKILL_AGENTS: readonly SkillAgent[] = ['claude', 'agy'];

export type PluginInfo = {
  /** `name@marketplace`, what the Claude CLI takes to install it. */
  id: string;
  name: string;
  marketplace: string;
  description: string;
  category?: string;
  author?: string;
  homepage?: string;
  /** GitHub account it lives under: its avatar is the logo. */
  owner?: string;
  /** What it adds, counted from its files (known only when the plugin is on this computer). */
  components?: { skills: number; commands: number; agents: number; hooks: boolean; mcp: boolean };
  installed: boolean;
  /** Only for an installed one. */
  enabled?: boolean;
  version?: string;
};

export type SkillInfo = {
  agent: SkillAgent;
  name: string;
  description: string;
  /** Where it comes from: the user's own folder, an installed plugin, or built into the agent. */
  source: 'user' | 'plugin' | 'builtin';
  /** Only skills in the user's own folder can be removed here. */
  removable: boolean;
  /** GitHub account whose avatar is the logo: the plugin's, or the skill's own `author`. */
  owner?: string;
};

export type Run = (command: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<string>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 2000): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined);

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Where each agent keeps the skills a user adds. */
export const skillsDir = (home: string, agent: SkillAgent): string => (agent === 'claude' ? join(home, '.claude', 'skills') : join(home, '.gemini', 'config', 'skills'));

const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}@[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Reads `name` and `description` from the `---` header of a SKILL.md (single-line or folded/block values). */
export function parseSkillHeader(source: string): { name?: string; description?: string; author?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return {};
  const lines = match[1]!.split(/\r?\n/);
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(name|description):\s*(.*)$/.exec(lines[i]!) ?? /^\s+(author):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    let value = kv[2]!.trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      value = block.join(' ');
    }
    if (/^".*"$/.test(value)) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    } else {
      value = value.replace(/^'([\s\S]*)'$/, '$1');
    }
    out[kv[1]!] = value;
  }
  return {
    ...(out['name'] ? { name: out['name'] } : {}),
    ...(out['description'] ? { description: out['description'] } : {}),
    ...(out['author'] ? { author: out['author'] } : {}),
  };
}

const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

async function skillsIn(dir: string, agent: SkillAgent, source: SkillInfo['source'], owner?: string): Promise<SkillInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found: SkillInfo[] = [];
  for (const dirName of names.sort()) {
    try {
      const header = parseSkillHeader(await readFile(join(dir, dirName, 'SKILL.md'), 'utf8'));
      const logo = owner ?? (header.author && ACCOUNT.test(header.author) ? header.author : undefined);
      const isManaged = dirName === 'scout' || dirName === 'claude';
      const effectiveSource = isManaged ? 'builtin' : source;
      const removable = !isManaged && source === 'user';
      found.push({ agent, name: header.name ?? dirName, description: (header.description ?? '').slice(0, 400), source: effectiveSource, removable, ...(logo ? { owner: logo } : {}) });
    } catch {
      // Not a skill folder.
    }
  }
  return found;
}

/** Every skill the agents will find: the user's own, those that came with Claude plugins, and the built-in ones. */
export async function listSkills(home: string, ownerOfPlugin: (id: string) => string | undefined = () => undefined): Promise<SkillInfo[]> {
  const out = [...(await skillsIn(skillsDir(home, 'claude'), 'claude', 'user'))];
  const installed = await readJson(join(home, '.claude', 'plugins', 'installed_plugins.json'));
  const plugins = isRecord(installed) && isRecord(installed['plugins']) ? installed['plugins'] : {};
  for (const [id, entries] of Object.entries(plugins)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (isRecord(entry) && typeof entry['installPath'] === 'string') out.push(...(await skillsIn(join(entry['installPath'], 'skills'), 'claude', 'plugin', ownerOfPlugin(id))));
    }
  }
  out.push(...(await skillsIn(skillsDir(home, 'agy'), 'agy', 'user')));
  out.push(...(await skillsIn(join(home, '.gemini', 'antigravity-cli', 'builtin', 'skills'), 'agy', 'builtin')));
  return out;
}

/** What a plugin that is on this computer adds, counted from its folder (null when the folder is not there). */
async function componentsOf(marketplaceDir: string, source: string): Promise<PluginInfo['components'] | undefined> {
  const dir = resolve(marketplaceDir, source);
  if (!dir.startsWith(resolve(marketplaceDir) + sep)) return undefined;
  const count = async (sub: string, test: (name: string, isDir: boolean) => boolean) =>
    (await readdir(join(dir, sub), { withFileTypes: true }).catch(() => [])).filter((e) => test(e.name, e.isDirectory())).length;
  if (!(await exists(dir))) return undefined;
  const [skills, commands, agents, hooks, mcp] = await Promise.all([
    count('skills', (_n, d) => d),
    count('commands', (n) => n.endsWith('.md')),
    count('agents', (n) => n.endsWith('.md')),
    exists(join(dir, 'hooks')),
    exists(join(dir, '.mcp.json')),
  ]);
  return { skills, commands, agents, hooks, mcp };
}

/** Claude's plugins: what the marketplaces offer (from their cached catalogues) with what is installed and enabled. */
export async function listPlugins(home: string): Promise<PluginInfo[]> {
  const base = join(home, '.claude', 'plugins');
  const known = await readJson(join(base, 'known_marketplaces.json'));
  const installedFile = await readJson(join(base, 'installed_plugins.json'));
  const settings = await readJson(join(home, '.claude', 'settings.json'));
  const installed = isRecord(installedFile) && isRecord(installedFile['plugins']) ? installedFile['plugins'] : {};
  const enabledMap = isRecord(settings) && isRecord(settings['enabledPlugins']) ? settings['enabledPlugins'] : {};
  const out: PluginInfo[] = [];
  const seen = new Set<string>();
  for (const [marketplace, info] of isRecord(known) ? Object.entries(known) : []) {
    const location = isRecord(info) && typeof info['installLocation'] === 'string' ? info['installLocation'] : join(base, 'marketplaces', marketplace);
    const catalogue = await readJson(join(location, '.claude-plugin', 'marketplace.json'));
    for (const p of isRecord(catalogue) && Array.isArray(catalogue['plugins']) ? catalogue['plugins'] : []) {
      if (!isRecord(p) || typeof p['name'] !== 'string') continue;
      const id = `${p['name']}@${marketplace}`;
      if (!PLUGIN_ID.test(id) || seen.has(id)) continue;
      seen.add(id);
      const entry = Array.isArray(installed[id]) ? (installed[id] as unknown[])[0] : undefined;
      const author = isRecord(p['author']) ? text(p['author']['name'], 120) : undefined;
      const category = text(p['category'], 60);
      const homepage = text(p['homepage'], 300);
      const version = isRecord(entry) ? text(entry['version'], 60) : undefined;
      const source = p['source'];
      const owner = githubOwnerOf(
        isRecord(source) ? text(source['url'], 300) : undefined,
        isRecord(source) && typeof source['repo'] === 'string' ? `https://github.com/${source['repo']}/` : undefined,
        homepage,
      );
      const components = typeof source === 'string' ? await componentsOf(location, source) : undefined;
      out.push({
        id,
        name: p['name'],
        marketplace,
        description: text(p['description'], 400) ?? '',
        ...(category ? { category } : {}),
        ...(author ? { author } : {}),
        ...(homepage ? { homepage } : {}),
        ...(owner ? { owner } : {}),
        ...(components ? { components } : {}),
        installed: entry !== undefined,
        ...(entry !== undefined ? { enabled: enabledMap[id] !== false } : {}),
        ...(version ? { version } : {}),
      });
    }
  }
  // Installed plugins whose marketplace is not cached any more still show up.
  for (const [id, entries] of Object.entries(installed)) {
    if (seen.has(id) || !PLUGIN_ID.test(id)) continue;
    const entry = Array.isArray(entries) ? entries[0] : undefined;
    const [name, marketplace] = id.split('@') as [string, string];
    const version = isRecord(entry) ? text(entry['version'], 60) : undefined;
    out.push({ id, name, marketplace, description: '', installed: true, enabled: enabledMap[id] !== false, ...(version ? { version } : {}) });
  }
  return out;
}

export type PluginAction = 'install' | 'uninstall' | 'enable' | 'disable';

/** Runs the Claude CLI for one plugin; the id is checked first, so nothing else reaches the command line. */
export async function pluginAction(run: Run, action: PluginAction, id: string): Promise<void> {
  if (!PLUGIN_ID.test(id)) throw new SomeCodeError('bad_request', 'plugin id must look like name@marketplace');
  try {
    await run('claude', ['plugin', action, id], 180_000);
  } catch (err) {
    throw new SomeCodeError('internal', `claude plugin ${action} failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
}

const MAX_SKILL_BYTES = 200 * 1024;

function target(home: string, agent: string, name: string): { dir: string; root: string } {
  if (!SKILL_AGENTS.includes(agent as SkillAgent)) throw new SomeCodeError('bad_request', 'unknown agent');
  if (!SKILL_NAME.test(name)) throw new SomeCodeError('bad_request', 'a skill name is lowercase letters, digits and dashes');
  const root = skillsDir(home, agent as SkillAgent);
  return { root, dir: join(root, name) };
}

const exists = (path: string) => stat(path).then(() => true, () => false);

/** Writes a skill of the user's own: `name`, `description` and the instructions as a SKILL.md. */
export async function addSkill(home: string, input: { agent: string; name: string; description: string; content: string }): Promise<void> {
  const { dir } = target(home, input.agent, input.name);
  const description = input.description.replace(/\s+/g, ' ').trim();
  if (description === '') throw new SomeCodeError('bad_request', 'a skill needs a description: it is how the agent knows when to use it');
  if (input.content.trim() === '') throw new SomeCodeError('bad_request', 'a skill needs instructions');
  const body = `---\nname: ${input.name}\ndescription: ${JSON.stringify(description)}\n---\n\n${input.content.trim()}\n`;
  if (Buffer.byteLength(body) > MAX_SKILL_BYTES) throw new SomeCodeError('bad_request', 'skill is too long');
  if (await exists(dir)) throw new SomeCodeError('bad_request', 'a skill with this name already exists');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), body, { flag: 'wx' });
}

/** Removes a skill from the user's own folder (never one from a plugin or built in). */
export async function removeSkill(home: string, agent: string, name: string): Promise<void> {
  if (name === 'scout' || name === 'claude') {
    throw new SomeCodeError('forbidden', 'This skill is managed by SomeCode settings and cannot be removed here');
  }
  const { dir, root } = target(home, agent, name);
  const resolved = resolve(dir);
  if (!resolved.startsWith(resolve(root) + sep) || !(await exists(join(resolved, 'SKILL.md')))) throw new SomeCodeError('not_found', 'no such skill');
  await rm(resolved, { recursive: true });
}

/** `https://host/owner/repo(.git)`: the only shape of address a skill repository is fetched from. */
const GIT_URL = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~/-]+$/;

async function findSkillDirs(root: string, depth = 0): Promise<string[]> {
  if (await exists(join(root, 'SKILL.md'))) return [root];
  if (depth >= 3) return [];
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') found.push(...(await findSkillDirs(join(root, entry.name), depth + 1)));
  }
  return found;
}

/**
 * Copies the skills of a Git repository (every folder with a SKILL.md, up to three levels down) into an agent's
 * skills folder. Only an https address is cloned, shallow and without asking for credentials; nothing from the
 * repository is run. A skill whose name already exists is left alone. Returns the names added.
 */
export async function addSkillsFromGit(home: string, run: Run, agent: string, url: string): Promise<string[]> {
  if (!SKILL_AGENTS.includes(agent as SkillAgent)) throw new SomeCodeError('bad_request', 'unknown agent');
  if (!GIT_URL.test(url) || url.includes('..')) throw new SomeCodeError('bad_request', 'give an https address of a Git repository');
  const root = skillsDir(home, agent as SkillAgent);
  const work = await mkdtemp(join(tmpdir(), 'somecode-skills-'));
  try {
    const repo = join(work, 'repo');
    try {
      await run('git', ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', 'clone', '--depth', '1', '--no-tags', '--', url, repo], 90_000, { GIT_TERMINAL_PROMPT: '0' });
    } catch {
      throw new SomeCodeError('bad_request', 'could not fetch that repository');
    }
    const added: string[] = [];
    for (const dir of (await findSkillDirs(repo)).slice(0, 30)) {
      const name = basename(dir === repo ? basename(url.replace(/\.git$/, '')) : dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
      if (!SKILL_NAME.test(name) || (await exists(join(root, name)))) continue;
      await mkdir(root, { recursive: true });
      await cp(dir, join(root, name), { recursive: true, filter: (src) => basename(src) !== '.git' });
      added.push(name);
    }
    if (added.length === 0) throw new SomeCodeError('bad_request', 'no new skill (a folder with SKILL.md) found in that repository');
    return added;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
