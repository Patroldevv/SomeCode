import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore } from '../store/store.ts';
import { DEFAULT_VERIFY, readVerify, suggestChecks, writeVerify } from './config.ts';
import { fixPrompt, runCheck } from './runner.ts';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'somecode-verify-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('verify config', () => {
  it('keeps a project\'s checks and falls back to the defaults for what is missing or unreadable', () => {
    const store = openStore(':memory:');
    expect(readVerify(store, 'p')).toEqual(DEFAULT_VERIFY);
    writeVerify(store, 'p', { enabled: true, autoFix: false, maxFixes: 3, checks: [{ name: 'Test', command: 'npm test' }] });
    expect(readVerify(store, 'p')).toMatchObject({ autoFix: false, maxFixes: 3, checks: [{ name: 'Test', command: 'npm test' }] });
    store.setSetting('verify:q', '{"maxFixes":99}');
    expect(readVerify(store, 'q')).toEqual(DEFAULT_VERIFY);
    store.setSetting('verify:r', 'not json');
    expect(readVerify(store, 'r')).toEqual(DEFAULT_VERIFY);
    store.close();
  });

  it('suggests only the checks a project really defines', () => {
    expect(suggestChecks(dir)).toEqual([]);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc -b', lint: 'eslint .', test: 'vitest run', build: 'vite build' } }));
    expect(suggestChecks(dir)).toEqual([
      { name: 'Typecheck', command: 'npm run typecheck' },
      { name: 'Lint', command: 'npm run lint' },
      { name: 'Test', command: 'npm test' },
    ]);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    expect(suggestChecks(dir)).toEqual([]);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'type-check': 'tsc' } }));
    expect(suggestChecks(dir)).toEqual([{ name: 'Typecheck', command: 'pnpm run type-check' }]);
    writeFileSync(join(dir, 'Cargo.toml'), '');
    expect(suggestChecks(dir).map((c) => c.command)).toContain('cargo test');
  });
});

describe('suggestChecks in other kinds of project', () => {
  const write = (name: string, content = '') => writeFileSync(join(dir, name), content);
  const commands = () => suggestChecks(dir).map((c) => c.command);

  it('falls back to tsc for a TypeScript project without a typecheck script, and knows Svelte/Astro check scripts', () => {
    write('package.json', JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { typescript: '^5' } }));
    expect(commands()).toEqual(['npx tsc --noEmit', 'npm run lint']);
    write('package.json', JSON.stringify({ scripts: { check: 'svelte-check --tsconfig ./tsconfig.json', 'test:unit': 'vitest run' } }));
    expect(commands()).toEqual(['npm run check', 'npm run test:unit']);
  });

  it('reads Makefile targets, Python tools, Deno tasks, Composer scripts and .NET, Gradle or Maven projects', () => {
    write('Makefile', 'build:\n\tcc x\n\ntest:\n\t./run\n\nlint:\n\techo\n');
    expect(commands()).toEqual(['make lint', 'make test']);
    rmSync(join(dir, 'Makefile'));
    write('pyproject.toml', '[tool.mypy]\nstrict = true\n[tool.ruff]\nline-length = 100\n');
    expect(commands()).toEqual(['mypy .', 'ruff check .', 'python -m pytest -q']);
    rmSync(join(dir, 'pyproject.toml'));
    write('deno.json', JSON.stringify({ tasks: { check: 'deno check main.ts', test: 'deno test' } }));
    write('composer.json', JSON.stringify({ scripts: { test: 'phpunit', lint: 'phpcs' } }));
    write('App.csproj');
    write('gradlew');
    expect(commands()).toEqual(['deno task check', 'deno task test', 'composer run lint', 'composer run test', 'dotnet build --nologo -v q', 'dotnet test --nologo -v q', './gradlew test --console=plain']);
  });

  it('never suggests more than eight checks, nor the same command twice', () => {
    write('Cargo.toml');
    write('go.mod');
    write('pom.xml');
    write('deno.json', JSON.stringify({ tasks: { check: 'x', lint: 'x', test: 'x' } }));
    write('composer.json', JSON.stringify({ scripts: { test: 'x', lint: 'x', analyse: 'x' } }));
    const list = commands();
    expect(list.length).toBeLessThanOrEqual(8);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('runCheck', () => {
  it('reports success, and the end of the output with the exit code on failure', async () => {
    const ok = await runCheck(dir, { name: 'ok', command: 'echo fine' });
    expect(ok).toMatchObject({ ok: true, exitCode: 0, output: 'fine' });
    const bad = await runCheck(dir, { name: 'bad', command: 'echo one; echo "two error" >&2; exit 3' });
    expect(bad).toMatchObject({ ok: false, exitCode: 3 });
    expect(bad.output).toContain('two error');
  });

  it('runs in the folder, keeps only the tail of long output and stops a command that takes too long', async () => {
    writeFileSync(join(dir, 'marker.txt'), 'x');
    expect((await runCheck(dir, { name: 'ls', command: 'ls' })).output).toContain('marker.txt');
    const long = await runCheck(dir, { name: 'long', command: 'node -e "console.log(\'a\'.repeat(20000)); console.log(\'THE END\')"' });
    expect(long.output.length).toBeLessThan(3100);
    expect(long.output.endsWith('THE END')).toBe(true);
    const slow = await runCheck(dir, { name: 'slow', command: 'sleep 30' }, { timeoutMs: 200 });
    expect(slow).toMatchObject({ ok: false, timedOut: true });
  });
});

describe('fixPrompt', () => {
  it('names what failed and tells the agent not to weaken the check', () => {
    const text = fixPrompt(
      [
        { name: 'Typecheck', command: 'npm run typecheck', ok: false, exitCode: 2, timedOut: false, output: 'src/a.ts(3,1): error TS2322', ms: 10 },
        { name: 'Lint', command: 'npm run lint', ok: true, exitCode: 0, timedOut: false, output: '', ms: 5 },
      ],
      1,
      2,
    );
    expect(text).toMatch(/^\[SomeCode check\]/);
    expect(text).toContain('fix round 1 of 2');
    expect(text).toContain('error TS2322');
    expect(text).not.toContain('### Lint');
    expect(text).toContain('Do not change a check');
  });
});
