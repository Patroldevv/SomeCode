/** Text files attached to a message travel inside the prompt text, wrapped so the chat can show them as chips. */
export type AttachedFile = { name: string; text: string };

/** The server cuts a prompt at 64 KiB, so everything attached has to fit well below that. */
export const MAX_FILE_BYTES = 40 * 1024;
export const MAX_TOTAL_BYTES = 56 * 1024;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env', 'csv', 'tsv', 'log', 'xml', 'html', 'htm', 'css', 'scss', 'svg',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'fish',
  'zsh', 'sql', 'graphql', 'proto', 'lua', 'r', 'dart', 'vue', 'svelte', 'tex', 'diff', 'patch', 'conf', 'lock', 'gradle', 'dockerfile',
]);

const extensionOf = (name: string): string => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : name.toLowerCase());

/** A file we read as text: a text type, or a well-known source/config extension. */
export function looksLikeText(file: { name: string; type: string }): boolean {
  return file.type.startsWith('text/') || /(json|xml|javascript|yaml|toml|x-sh)/.test(file.type) || TEXT_EXTENSIONS.has(extensionOf(file.name));
}

export type FileCheck = { ok: true; text: string } | { ok: false; reason: 'binary' | 'tooLarge' };

export function checkText(text: string, bytes: number): FileCheck {
  if (text.includes('\0')) return { ok: false, reason: 'binary' };
  if (bytes > MAX_FILE_BYTES) return { ok: false, reason: 'tooLarge' };
  return { ok: true, text };
}

export const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const CLOSE = '</attached-file>';
const safeName = (name: string) => name.replace(/["<>\n\r]/g, '_').slice(0, 120);

/** The message text followed by one wrapped block per file. */
export function withAttachedFiles(text: string, files: AttachedFile[]): string {
  if (files.length === 0) return text;
  const blocks = files.map((f) => `<attached-file name="${safeName(f.name)}">\n${f.text.replaceAll(CLOSE, '</attached-file >')}\n${CLOSE}`);
  return [text, ...blocks].filter((part) => part !== '').join('\n\n');
}

const BLOCK = /\n*<attached-file name="([^"\n]*)">\n([\s\S]*?)\n<\/attached-file>/g;

/** Splits a sent message back into what the user typed and the files that came with it. */
export function splitAttachedFiles(text: string): { body: string; files: { name: string; bytes: number }[] } {
  const files: { name: string; bytes: number }[] = [];
  const body = text.replace(BLOCK, (_all, name: string, content: string) => {
    files.push({ name, bytes: byteLength(content) });
    return '';
  });
  return { body: body.trim(), files };
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}
