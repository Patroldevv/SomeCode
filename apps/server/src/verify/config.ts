import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Store } from '../store/store.ts';

const MAX_CHECKS = 8;

export const checkSchema = z.object({
  name: z.string().trim().min(1).max(40),
  command: z.string().trim().min(1).max(400),
});

/** What a project is checked with after the agent changed files. */
export const verifyConfigSchema = z.object({
  /** Run the checks after a turn that changed files. */
  enabled: z.boolean(),
  /** Hand a failure to the agent to fix. */
  autoFix: z.boolean(),
  /** How many automatic fix rounds at most (per message of the user). */
  maxFixes: z.number().int().min(0).max(3),
  checks: z.array(checkSchema).max(MAX_CHECKS),
});
export type VerifyConfig = z.infer<typeof verifyConfigSchema>;
export type Check = z.infer<typeof checkSchema>;

export const DEFAULT_VERIFY: VerifyConfig = { enabled: true, autoFix: true, maxFixes: 2, checks: [] };

const key = (projectId: string) => `verify:${projectId}`;

export function readVerify(store: Pick<Store, 'getSetting'>, projectId: string): VerifyConfig {
  const raw = store.getSetting(key(projectId));
  if (raw === null) return DEFAULT_VERIFY;
  try {
    const parsed = verifyConfigSchema.partial().safeParse(JSON.parse(raw));
    return parsed.success ? { ...DEFAULT_VERIFY, ...parsed.data } : DEFAULT_VERIFY;
  } catch {
    return DEFAULT_VERIFY;
  }
}

export function writeVerify(store: Pick<Store, 'setSetting'>, projectId: string, config: VerifyConfig): void {
  store.setSetting(key(projectId), JSON.stringify(config));
}

const readJson = (path: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const text = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Checks a folder suggests by what is in it: the scripts of a package.json (typecheck, lint, test), a tsconfig, Makefile
 * targets, and Cargo, Go, Python, Deno, Composer, .NET, Gradle and Maven projects. Only what the project really defines
 * is suggested; the order is typecheck, lint, test.
 */
export function suggestChecks(folder: string): Check[] {
  const out: Check[] = [];
  const has = (name: string) => existsSync(join(folder, name));
  const add = (name: string, command: string) => {
    if (!out.some((c) => c.command === command)) out.push({ name, command });
  };

  const pkg = has('package.json') ? readJson(join(folder, 'package.json')) : null;
  if (pkg) {
    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;
    const deps = { ...((pkg['dependencies'] ?? {}) as object), ...((pkg['devDependencies'] ?? {}) as object) } as Record<string, string>;
    const runner = has('pnpm-lock.yaml') ? 'pnpm run' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun run' : 'npm run';
    const run = (name: string) => (name === 'test' ? (runner === 'yarn' ? 'yarn test' : `${runner === 'npm run' ? 'npm' : runner} test`) : `${runner} ${name}`);
    const pick = (label: string, names: string[]) => {
      const name = names.find((n) => typeof scripts[n] === 'string' && !/no test specified/i.test(scripts[n]!));
      if (name) add(label, run(name));
      return name !== undefined;
    };
    const typed = pick('Typecheck', ['typecheck', 'type-check', 'check-types', 'check:types', 'types', 'tsc']) || (typeof scripts['check'] === 'string' && /svelte-check|tsc|astro check/.test(scripts['check']) && (add('Typecheck', run('check')), true));
    if (!typed && (has('tsconfig.json') || 'typescript' in deps)) add('Typecheck', 'npx tsc --noEmit');
    pick('Lint', ['lint', 'lint:check', 'eslint', 'biome']);
    pick('Test', ['test', 'test:unit', 'test:run', 'vitest', 'jest']);
  }

  const make = has('Makefile') ? text(join(folder, 'Makefile')) : null;
  if (make) {
    const target = (name: string) => new RegExp(`^${name}\\s*:`, 'm').test(make);
    if (!out.some((c) => c.name === 'Typecheck') && target('typecheck')) add('Typecheck', 'make typecheck');
    if (!out.some((c) => c.name === 'Lint') && target('lint')) add('Lint', 'make lint');
    if (!out.some((c) => c.name === 'Test') && target('test')) add('Test', 'make test');
    else if (!out.some((c) => c.name === 'Test') && target('check')) add('Check', 'make check');
  }

  if (has('Cargo.toml')) {
    add('Cargo check', 'cargo check');
    add('Test', 'cargo test');
  }
  if (has('go.mod')) {
    add('Go vet', 'go vet ./...');
    add('Test', 'go test ./...');
  }
  const pyproject = has('pyproject.toml') ? text(join(folder, 'pyproject.toml')) : null;
  if (pyproject !== null || has('pytest.ini') || has('setup.cfg') || has('tox.ini')) {
    if (pyproject && /\[tool\.mypy\]/.test(pyproject)) add('Typecheck', 'mypy .');
    if ((pyproject && /\[tool\.ruff/.test(pyproject)) || has('ruff.toml') || has('.ruff.toml')) add('Lint', 'ruff check .');
    add('Test', has('tox.ini') && !pyproject?.includes('pytest') ? 'tox' : 'python -m pytest -q');
  }
  const deno = has('deno.json') ? readJson(join(folder, 'deno.json')) : has('deno.jsonc') ? null : null;
  if (deno) {
    const tasks = (deno['tasks'] ?? {}) as Record<string, string>;
    for (const [label, name] of [['Check', 'check'], ['Lint', 'lint'], ['Test', 'test']] as const) if (typeof tasks[name] === 'string') add(label, `deno task ${name}`);
  }
  const composer = has('composer.json') ? readJson(join(folder, 'composer.json')) : null;
  if (composer) {
    const scripts = (composer['scripts'] ?? {}) as Record<string, unknown>;
    for (const [label, name] of [['Lint', 'lint'], ['Analyse', 'analyse'], ['Test', 'test']] as const) if (name in scripts) add(label, `composer run ${name}`);
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(folder);
  } catch {
    // an unreadable folder suggests nothing more
  }
  if (entries.some((e) => /\.(sln|csproj)$/.test(e))) {
    add('Build', 'dotnet build --nologo -v q');
    add('Test', 'dotnet test --nologo -v q');
  }
  if (has('gradlew')) add('Test', './gradlew test --console=plain');
  else if (has('pom.xml')) add('Test', 'mvn -q test');
  return out.slice(0, MAX_CHECKS);
}
