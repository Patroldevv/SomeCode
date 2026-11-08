import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addSkill, addSkillsFromGit, listPlugins, listSkills, parseSkillHeader, pluginAction, removeSkill, type Run } from './catalog.ts';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'somecode-home-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const put = async (path: string, content: string) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
};
const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: "${description}"\n---\n\nBody`;

describe('parseSkillHeader', () => {
  it('reads quoted, plain and folded values, and nothing from a file without a header', () => {
    expect(parseSkillHeader('---\nname: a\ndescription: "Does a thing"\n---\nx')).toEqual({ name: 'a', description: 'Does a thing' });
    expect(parseSkillHeader("---\nname: b\ndescription: 'Plain'\n---")).toEqual({ name: 'b', description: 'Plain' });
    expect(parseSkillHeader('---\nname: c\ndescription: >\n  first line\n  second line\nother: 1\n---')).toEqual({ name: 'c', description: 'first line second line' });
    expect(parseSkillHeader('no header')).toEqual({});
  });
});

describe('listSkills', () => {
  it('finds the user\'s skills (removable), plugin skills and built-in ones, and skips folders that are not skills', async () => {
    await put(join(home, '.claude/skills/mine/SKILL.md'), skill('mine', 'My skill'));
    await put(join(home, '.claude/skills/not-a-skill/readme.md'), 'x');
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'p@m': [{ installPath: join(home, 'cache/p') }] } }));
    await put(join(home, 'cache/p/skills/from-plugin/SKILL.md'), skill('from-plugin', 'Plugin skill'));
    await put(join(home, '.gemini/config/skills/g/SKILL.md'), skill('g', 'Gemini skill'));
    await put(join(home, '.gemini/antigravity-cli/builtin/skills/core/SKILL.md'), skill('core', 'Built in'));
    const skills = await listSkills(home);
    expect(skills.map((s) => [s.agent, s.name, s.source, s.removable])).toEqual([
      ['claude', 'mine', 'user', true],
      ['claude', 'from-plugin', 'plugin', false],
      ['agy', 'g', 'user', true],
      ['agy', 'core', 'builtin', false],
    ]);
  });

  it('gives plugin skills their plugin\'s owner and user skills their own author (when it is an account name)', async () => {
    await put(join(home, '.claude/skills/mine/SKILL.md'), '---\nname: mine\ndescription: x\nmetadata:\n  author: supabase\n---\n');
    await put(join(home, '.claude/skills/odd/SKILL.md'), '---\nname: odd\ndescription: x\nmetadata:\n  author: Some Body (me)\n---\n');
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'p@m': [{ installPath: join(home, 'cache/p') }] } }));
    await put(join(home, 'cache/p/skills/s/SKILL.md'), skill('s', 'Plugin skill'));
    const skills = await listSkills(home, (id) => (id === 'p@m' ? 'acme' : undefined));
    expect(skills.find((s) => s.name === 'mine')?.owner).toBe('supabase');
    expect(skills.find((s) => s.name === 'odd')?.owner).toBeUndefined();
    expect(skills.find((s) => s.name === 's')?.owner).toBe('acme');
  });

  it('is empty on a computer with none of the agents', async () => {
    expect(await listSkills(home)).toEqual([]);
  });
});

describe('listPlugins', () => {
  it('lists the marketplace catalogue with what is installed and enabled, and keeps an installed plugin whose catalogue is gone', async () => {
    const loc = join(home, '.claude/plugins/marketplaces/official');
    await put(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ official: { installLocation: loc } }));
    await put(join(loc, '.claude-plugin/marketplace.json'), JSON.stringify({
      plugins: [
        { name: 'alpha', description: 'First', category: 'security', author: { name: 'Acme' }, homepage: 'https://a.example' },
        { name: 'beta', description: 'Second' },
        { name: 'bad name!', description: 'ignored' },
      ],
    }));
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'beta@official': [{ version: '1.2.0' }], 'old@gone': [{ version: '0.1' }] } }));
    await put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'beta@official': false } }));
    const plugins = await listPlugins(home);
    expect(plugins.map((p) => [p.id, p.installed, p.enabled])).toEqual([
      ['alpha@official', false, undefined],
      ['beta@official', true, false],
      ['old@gone', true, true],
    ]);
    expect(plugins[0]).toMatchObject({ category: 'security', author: 'Acme', homepage: 'https://a.example', description: 'First' });
    expect(plugins[1]).toMatchObject({ version: '1.2.0' });
  });
});

describe('plugin owner and contents', () => {
  it('reads the GitHub account and counts what a local plugin adds', async () => {
    const loc = join(home, '.claude/plugins/marketplaces/official');
    await put(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ official: { installLocation: loc } }));
    await put(join(loc, '.claude-plugin/marketplace.json'), JSON.stringify({
      plugins: [
        { name: 'local', description: 'd', source: './plugins/local', homepage: 'https://github.com/anthropics/claude-plugins-public/tree/main/plugins/local' },
        { name: 'remote', description: 'd', source: { source: 'git-subdir', url: 'https://github.com/Acme/repo.git', path: 'p' } },
        { name: 'repo-form', description: 'd', source: { source: 'github', repo: 'Beta/tool' } },
        { name: 'escape', description: 'd', source: '../../outside' },
      ],
    }));
    await put(join(loc, 'plugins/local/skills/s1/SKILL.md'), skill('s1', 'x'));
    await put(join(loc, 'plugins/local/skills/s2/SKILL.md'), skill('s2', 'x'));
    await put(join(loc, 'plugins/local/commands/c.md'), 'x');
    await put(join(loc, 'plugins/local/commands/not-md.txt'), 'x');
    await put(join(loc, 'plugins/local/.mcp.json'), '{}');
    const byName = Object.fromEntries((await listPlugins(home)).map((p) => [p.name, p]));
    expect(byName['local']).toMatchObject({ owner: 'anthropics', components: { skills: 2, commands: 1, agents: 0, hooks: false, mcp: true } });
    expect(byName['remote']).toMatchObject({ owner: 'Acme' });
    expect(byName['remote']).not.toHaveProperty('components');
    expect(byName['repo-form']).toMatchObject({ owner: 'Beta' });
    expect(byName['escape']).not.toHaveProperty('components');
  });
});

describe('pluginAction', () => {
  it('runs the Claude CLI for a well-formed id and refuses anything else before running', async () => {
    const run = vi.fn(async () => '');
    await pluginAction(run, 'install', 'alpha@official');
    expect(run).toHaveBeenCalledWith('claude', ['plugin', 'install', 'alpha@official'], expect.any(Number));
    for (const bad of ['alpha', '--evil@x', 'a b@c', 'a@b;rm -rf', '@m', '']) {
      await expect(pluginAction(run, 'install', bad)).rejects.toMatchObject({ code: 'bad_request' });
    }
    expect(run).toHaveBeenCalledOnce();
  });

  it('turns a failed CLI run into an error', async () => {
    await expect(pluginAction(async () => { throw new Error('boom\nmore'); }, 'uninstall', 'a@b')).rejects.toMatchObject({ code: 'internal', message: expect.stringContaining('boom') });
  });
});

describe('add and remove a skill', () => {
  it('writes a SKILL.md with a header, and lists it as removable', async () => {
    await addSkill(home, { agent: 'claude', name: 'my-skill', description: 'Use it  when "quoted"\nthings', content: '# Steps\n1. Do it' });
    const file = await readFile(join(home, '.claude/skills/my-skill/SKILL.md'), 'utf8');
    expect(parseSkillHeader(file)).toEqual({ name: 'my-skill', description: 'Use it when "quoted" things' });
    expect(file).toContain('# Steps');
    expect((await listSkills(home))[0]).toMatchObject({ name: 'my-skill', removable: true });
    await addSkill(home, { agent: 'agy', name: 'g-skill', description: 'x', content: 'y' });
    expect(existsSync(join(home, '.gemini/config/skills/g-skill/SKILL.md'))).toBe(true);
  });

  it('refuses a bad name, an unknown agent, an empty body, a duplicate and a skill that is too long', async () => {
    const ok = { agent: 'claude', name: 'fine', description: 'd', content: 'c' };
    for (const bad of [{ name: '../escape' }, { name: 'Upper' }, { name: '' }, { agent: 'other' }, { description: '  ' }, { content: ' ' }, { content: 'x'.repeat(250_000) }]) {
      await expect(addSkill(home, { ...ok, ...bad })).rejects.toMatchObject({ code: 'bad_request' });
    }
    await addSkill(home, ok);
    await expect(addSkill(home, ok)).rejects.toMatchObject({ code: 'bad_request', message: expect.stringContaining('already exists') });
  });

  it('removes only a skill of the user\'s own folder', async () => {
    await addSkill(home, { agent: 'claude', name: 'mine', description: 'd', content: 'c' });
    await put(join(home, '.claude/skills/not-a-skill/readme.md'), 'x');
    await removeSkill(home, 'claude', 'mine');
    expect(existsSync(join(home, '.claude/skills/mine'))).toBe(false);
    await expect(removeSkill(home, 'claude', 'mine')).rejects.toMatchObject({ code: 'not_found' });
    await expect(removeSkill(home, 'claude', 'not-a-skill')).rejects.toMatchObject({ code: 'not_found' });
    await expect(removeSkill(home, 'claude', '../plugins')).rejects.toMatchObject({ code: 'bad_request' });
    expect(existsSync(join(home, '.claude/skills/not-a-skill/readme.md'))).toBe(true);
  });
});

describe('addSkillsFromGit', () => {
  const clone = (files: Record<string, string>): Run =>
    vi.fn(async (_cmd: string, args: string[]) => {
      const repo = args[args.length - 1]!;
      for (const [path, content] of Object.entries(files)) await put(join(repo, path), content);
      return '';
    });

  it('clones an https repository shallowly and copies every skill folder that is new', async () => {
    await addSkill(home, { agent: 'claude', name: 'existing', description: 'd', content: 'c' });
    const run = clone({
      'skills/one/SKILL.md': skill('one', 'First'),
      'skills/one/extra.txt': 'data',
      'skills/Two Skill/SKILL.md': skill('two', 'Second'),
      'skills/existing/SKILL.md': skill('existing', 'Already there'),
      'README.md': 'x',
      '.git/config': 'x',
    });
    const added = await addSkillsFromGit(home, run, 'claude', 'https://github.com/o/r.git');
    expect(added.sort()).toEqual(['one', 'two-skill']);
    expect(existsSync(join(home, '.claude/skills/one/extra.txt'))).toBe(true);
    expect(existsSync(join(home, '.claude/skills/two-skill/SKILL.md'))).toBe(true);
    const [command, args, , env] = (run as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], number, NodeJS.ProcessEnv];
    expect(command).toBe('git');
    expect(args).toEqual(expect.arrayContaining(['protocol.allow=never', 'protocol.https.allow=always', '--depth', '1', 'https://github.com/o/r.git']));
    expect(env).toEqual({ GIT_TERMINAL_PROMPT: '0' });
  });

  it('takes a repository that is itself one skill, named after the repository', async () => {
    const added = await addSkillsFromGit(home, clone({ 'SKILL.md': skill('x', 'Whole repo') }), 'agy', 'https://github.com/o/My_Skill');
    expect(added).toEqual(['my-skill']);
    expect(existsSync(join(home, '.gemini/config/skills/my-skill/SKILL.md'))).toBe(true);
  });

  it('refuses anything but an https address, and says so when nothing new is found or the fetch fails', async () => {
    const run = clone({});
    for (const url of ['http://github.com/o/r', 'file:///etc', 'ext::sh -c x', 'git@github.com:o/r.git', 'https://github.com/o/../x', 'https://x y/z']) {
      await expect(addSkillsFromGit(home, run, 'claude', url)).rejects.toMatchObject({ code: 'bad_request' });
    }
    expect(run).not.toHaveBeenCalled();
    await expect(addSkillsFromGit(home, run, 'claude', 'https://github.com/o/r')).rejects.toMatchObject({ code: 'bad_request', message: expect.stringContaining('no new skill') });
    await expect(addSkillsFromGit(home, async () => { throw new Error('nope'); }, 'claude', 'https://github.com/o/r')).rejects.toMatchObject({ message: expect.stringContaining('could not fetch') });
    await expect(addSkillsFromGit(home, run, 'nobody', 'https://github.com/o/r')).rejects.toMatchObject({ code: 'bad_request' });
  });
});
