import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { connectService, disconnectService, listServices } from './services.ts';
import { addSkill, addSkillsFromGit, listPlugins, listSkills, pluginAction, removeSkill, type PluginAction, type Run } from './catalog.ts';

export const realRun: Run = (command, args, timeoutMs, env) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, cwd: tmpdir(), maxBuffer: 4 << 20, env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message))) : resolve(stdout),
    );
  });

/** Plugins and skills of the agents on this computer, rooted at `home` (the real home folder unless a test says otherwise). */
export function createPluginService(home: string = homedir(), run: Run = realRun) {
  return {
    async overview() {
      const plugins = await listPlugins(home);
      const owners = new Map(plugins.flatMap((p) => (p.owner ? [[p.id, p.owner] as const] : [])));
      return { plugins, skills: await listSkills(home, (id) => owners.get(id)) };
    },
    plugin: (action: PluginAction, id: string) => pluginAction(run, action, id),
    services: () => listServices(home),
    connect: (input: { name: string; url: string; transport: string; token?: string }) => connectService(run, input),
    disconnect: (name: string) => disconnectService(run, name),
    addSkill: (input: { agent: string; name: string; description: string; content: string }) => addSkill(home, input),
    removeSkill: (agent: string, name: string) => removeSkill(home, agent, name),
    addSkillsFromGit: (agent: string, url: string) => addSkillsFromGit(home, run, agent, url),
  };
}
export type PluginService = ReturnType<typeof createPluginService>;
