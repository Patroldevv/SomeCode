/**
 * Plan mode is for looking around, but agents still ask before every `ls` or `git status`. These helpers decide
 * which commands are plainly read-only, so a plan-mode session can run them without asking. Anything unusual
 * (redirects, substitutions, unknown programs, a mutating git/find option) is NOT read-only and still asks.
 */
const PLAIN = new Set([
  'ls', 'll', 'dir', 'tree', 'find', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'pwd', 'echo', 'printf',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'which', 'whereis', 'type', 'whoami', 'id', 'uname', 'hostname', 'df', 'du', 'free',
  'date', 'uptime', 'nproc', 'lsblk', 'realpath', 'readlink', 'basename', 'dirname', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp',
  'jq', 'column', 'nl', 'tac', 'md5sum', 'sha256sum', 'sha1sum', 'true', 'test', 'ps', 'lscpu', 'locale', 'printenv',
]);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'ls-tree', 'cat-file', 'rev-list', 'grep', 'diff-tree', 'name-rev']);
const FIND_MUTATING = /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/;
const MAX_COMMAND_CHARS = 2_000;

/** Splits a command line into words, honouring quotes; null when it holds anything a shell would expand or redirect. */
function words(segment: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let any = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && (c === '$' || c === '`' || c === '\\')) return null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      any = true;
    } else if (c === '$' || c === '`' || c === '\\' || c === '>' || c === '<' || c === '(' || c === ')' || c === '{' || c === '}' || c === '&') {
      return null;
    } else if (/\s/.test(c)) {
      if (any || cur) out.push(cur);
      cur = '';
      any = false;
    } else {
      cur += c;
      any = true;
    }
  }
  if (quote) return null;
  if (any || cur) out.push(cur);
  return out;
}

function segmentIsReadOnly(segment: string): boolean {
  const ws = words(segment.trim());
  if (!ws || ws.length === 0) return false;
  const program = ws[0]!.split('/').pop()!;
  if (/=/.test(ws[0]!)) return false; // VAR=value prefix
  if (program === 'git') {
    let i = 1;
    while (i < ws.length && ws[i]!.startsWith('-')) {
      if (ws[i] === '-C' && i + 1 < ws.length) i += 2; // run in another directory: still only reading
      else if (ws[i] === '--no-pager' || ws[i] === '--no-optional-locks') i += 1;
      else return false;
    }
    const sub = ws[i];
    if (!sub) return false;
    const rest = ws.slice(i + 1);
    if (GIT_READ.has(sub)) return !rest.some((a) => a === '--output' || a.startsWith('--output=') || a === '--ext-diff');
    if (sub === 'remote') return rest.length === 0 || (rest.length === 1 && (rest[0] === '-v' || rest[0] === '--verbose'));
    if (sub === 'branch') return rest.every((a) => ['-a', '-r', '-v', '-vv', '--list', '--show-current', '--all', '--remotes'].includes(a));
    return false;
  }
  if (!PLAIN.has(program)) return false;
  if (program === 'find') return !ws.some((a) => FIND_MUTATING.test(a));
  if (program === 'sort') return !ws.some((a) => a === '-o' || a.startsWith('--output'));
  if (program === 'tree') return !ws.some((a) => a === '-o');
  return true;
}

/** The harmless stderr plumbing that read-only commands are often written with. */
const PLUMBING = /\s2>\s*(?:\/dev\/null|&1)(?=\s|$)/g;

/** True when every part of the command line is a known read-only program, joined only by `&&`, `||`, `;` or `|`. */
export function isReadOnlyCommand(command: string): boolean {
  if (command.length === 0 || command.length > MAX_COMMAND_CHARS || /[\n\r]/.test(command)) return false;
  const cleaned = command.replace(PLUMBING, ' ');
  // Split on the joiners outside quotes.
  const parts: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i]!;
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ';' || c === '|') {
      parts.push(cur);
      cur = '';
      if (cleaned[i + 1] === c) i++;
    } else if (c === '&' && cleaned[i + 1] === '&') {
      parts.push(cur);
      cur = '';
      i++;
    } else {
      cur += c;
    }
  }
  if (quote) return false;
  parts.push(cur);
  const segments = parts.filter((p) => p.trim() !== '');
  return segments.length > 0 && segments.every(segmentIsReadOnly);
}
