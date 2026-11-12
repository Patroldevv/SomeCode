import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdir, open, opendir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { SomeCodeError } from '@somecode/protocol';

const MAX_PATH = 4096;
const MAX_ENTRIES = 500;
const MAX_SCAN = 5000;
const MAX_PREVIEW_BYTES = 256 * 1024;
const IGNORED = new Set(['.git', 'node_modules']);
export type FileEntry = { name: string; path: string; type: 'file' | 'directory' };

function checkPath(path: string): void {
  if (path.length > MAX_PATH || path.includes('\0')) throw new SomeCodeError('bad_request', 'invalid path');
}
function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function fileError(error: unknown): never {
  if (error instanceof SomeCodeError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') throw new SomeCodeError('not_found', 'path not found');
  if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') throw new SomeCodeError('forbidden', 'path is not accessible');
  throw error;
}

export async function projectPath(projectRoot: string, path = ''): Promise<{ root: string; target: string }> {
  checkPath(path);
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new SomeCodeError('forbidden', 'path must stay inside the project');
  try {
    // Project registration stores a canonical absolute path. Never grant trust
    // to a replacement symlink's target; old noncanonical registrations must
    // be selected again so the user explicitly chooses their actual root.
    const trustedRoot = resolve(projectRoot);
    const root = await realpath(trustedRoot);
    if (root !== trustedRoot) throw new SomeCodeError('forbidden', 'project root changed; select the folder again');
    const target = await realpath(resolve(root, path));
    if (!contained(root, target)) throw new SomeCodeError('forbidden', 'path must stay inside the project');
    return { root, target };
  } catch (error) { return fileError(error); }
}

async function openConfinedDirectory(root: string, target: string) {
  const file = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const openedPath = await realpath(`/proc/self/fd/${file.fd}`);
    if (!contained(root, openedPath)) throw new SomeCodeError('forbidden', 'path must stay inside the project');
    // Enumerate the verified inode, rather than resolving its mutable pathname again.
    const directory = await opendir(`/proc/self/fd/${file.fd}`);
    return { file, directory };
  } catch (error) {
    await file.close();
    throw error;
  }
}

export async function browseFolders(path = homedir()): Promise<{ path: string; parent: string | null; entries: Array<{ name: string; path: string }> }> {
  checkPath(path);
  if (!isAbsolute(path)) throw new SomeCodeError('bad_request', 'folder path must be absolute');
  try {
    const target = await realpath(path);
    const entries: Array<{ name: string; path: string }> = [];
    let scanned = 0;
    for await (const entry of await opendir(target)) {
      if (++scanned > MAX_SCAN || entries.length >= MAX_ENTRIES) break;
      if (entry.isDirectory()) entries.push({ name: entry.name, path: join(target, entry.name) });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { path: target, parent: dirname(target) === target ? null : dirname(target), entries };
  } catch (error) { return fileError(error); }
}

export async function listFiles(projectRoot: string, path = ''): Promise<{ entries: FileEntry[] }> {
  const { root, target } = await projectPath(projectRoot, path);
  try {
    const { file, directory } = await openConfinedDirectory(root, target);
    try {
      const entries: FileEntry[] = [];
      let scanned = 0;
      for await (const entry of directory) {
        if (++scanned > MAX_SCAN || entries.length >= MAX_ENTRIES) break;
        if (IGNORED.has(entry.name)) continue;
        const child = join(target, entry.name);
        let kind: FileEntry['type'];
        if (entry.isDirectory()) kind = 'directory';
        else if (entry.isFile()) kind = 'file';
        else if (entry.isSymbolicLink()) {
          try {
            const real = await realpath(child);
            if (!contained(root, real)) continue;
            const info = await stat(real);
            if (!info.isDirectory() && !info.isFile()) continue;
            kind = info.isDirectory() ? 'directory' : 'file';
          } catch { continue; }
        } else continue;
        entries.push({ name: entry.name, path: relative(root, child), type: kind });
      }
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
      return { entries };
    } finally { await file.close(); }
  } catch (error) { return fileError(error); }
}

export async function previewFile(projectRoot: string, path: string): Promise<{ path: string; text: string; truncated: boolean }> {
  const { root, target } = await projectPath(projectRoot, path);
  try {
    // O_NONBLOCK avoids hanging on a FIFO that replaced a file between realpath and open.
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      // Linux: check the descriptor itself, including intermediate directory symlink races.
      const openedPath = await realpath(`/proc/self/fd/${file.fd}`);
      if (!contained(root, openedPath)) throw new SomeCodeError('forbidden', 'path must stay inside the project');
      const info = await file.stat();
      if (!info.isFile()) throw new SomeCodeError('bad_request', 'path is not a regular file');
      const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, Math.min(bytesRead, MAX_PREVIEW_BYTES));
      if (bytes.includes(0)) throw new SomeCodeError('bad_request', 'binary files cannot be previewed');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: bytesRead > MAX_PREVIEW_BYTES }); }
      catch { throw new SomeCodeError('bad_request', 'file is not UTF-8 text'); }
      return { path, text, truncated: info.size > MAX_PREVIEW_BYTES || bytesRead > MAX_PREVIEW_BYTES };
    } finally { await file.close(); }
  } catch (error) { return fileError(error); }
}

export async function searchFiles(projectRoot: string, query: string): Promise<{ paths: string[] }> {
  if (query.length > 200 || query.includes('\0')) throw new SomeCodeError('bad_request', 'search query is too long');
  const { root } = await projectPath(projectRoot);
  const paths: string[] = [];
  const directories = [root];
  const needle = query.trim().toLocaleLowerCase();
  let scanned = 0;
  // Never follow symlink directories: this also avoids cycles and duplicate trees.
  while (directories.length && scanned < MAX_SCAN && paths.length < 100) {
    const target = directories.shift()!;
    try {
      const real = await realpath(target);
      if (!contained(root, real)) continue;
      const { file, directory } = await openConfinedDirectory(root, real);
      try {
        for await (const entry of directory) {
          if (++scanned > MAX_SCAN || paths.length >= 100) break;
          if (IGNORED.has(entry.name)) continue;
          const child = join(real, entry.name);
          if (entry.isDirectory()) directories.push(child);
          else if (entry.isFile()) {
            const path = relative(root, child);
            if (path.toLocaleLowerCase().includes(needle)) paths.push(path);
          }
        }
      } finally { await file.close(); }
    } catch { /* A concurrently removed or inaccessible folder should not fail all search. */ }
  }
  return { paths: paths.sort((a, b) => a.localeCompare(b)) };
}

const execFileAsync = promisify(execFile);
export const defaultGitRun = async (args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> => {
  const { stdout, stderr } = await execFileAsync('git', args, { cwd });
  return { stdout: String(stdout), stderr: String(stderr) };
};

export async function safeProjectPath(projectRoot: string, path: string): Promise<{ root: string; target: string }> {
  checkPath(path);
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new SomeCodeError('forbidden', 'path must stay inside the project');
  }
  const trustedRoot = resolve(projectRoot);
  const root = await realpath(trustedRoot);
  if (root !== trustedRoot) {
    throw new SomeCodeError('forbidden', 'project root changed; select the folder again');
  }
  const target = resolve(root, path);
  if (!contained(root, target)) {
    throw new SomeCodeError('forbidden', 'path must stay inside the project');
  }
  try {
    const realTarget = await realpath(target);
    if (!contained(root, realTarget)) {
      throw new SomeCodeError('forbidden', 'path must stay inside the project');
    }
  } catch {
    // Non-existent path is allowed for pending writes / removals
  }
  return { root, target };
}

export async function revertProjectFiles(
  projectRoot: string,
  options: {
    files?: Array<{ path: string; content?: string | null }>;
    paths?: string[];
  } = {},
  runGit: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }> = defaultGitRun,
): Promise<{ ok: boolean; reverted: string[] }> {
  const trustedRoot = resolve(projectRoot);
  const root = await realpath(trustedRoot);
  if (root !== trustedRoot) throw new SomeCodeError('forbidden', 'project root changed; select the folder again');

  const reverted: string[] = [];

  if (options.files && options.files.length > 0) {
    for (const item of options.files) {
      const { target } = await safeProjectPath(root, item.path);
      if (item.content === null || item.content === undefined) {
        try {
          await rm(target, { force: true });
          reverted.push(item.path);
        } catch {
          // ignore if already deleted
        }
      } else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, item.content, 'utf8');
        reverted.push(item.path);
      }
    }
    return { ok: true, reverted };
  }

  // Git-based rollback
  const hasGit = await stat(join(root, '.git')).then((s) => s.isDirectory() || s.isFile()).catch(() => false);
  if (!hasGit) {
    throw new SomeCodeError('bad_request', 'Project is not a git repository and no previous file content was provided');
  }

  if (options.paths && options.paths.length > 0) {
    for (const p of options.paths) {
      await safeProjectPath(root, p);
    }
    await runGit(['checkout', 'HEAD', '--', ...options.paths], root);
    await runGit(['clean', '-f', '--', ...options.paths], root).catch(() => {});
    reverted.push(...options.paths);
  } else {
    await runGit(['checkout', 'HEAD', '--', '.'], root);
    await runGit(['clean', '-fd', '.'], root).catch(() => {});
    reverted.push('.');
  }

  return { ok: true, reverted };
}
