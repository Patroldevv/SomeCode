import type { ReactNode } from 'react';

export function getFileExtension(path: string): string {
  const clean = path.split('?')[0]?.split('#')[0] ?? '';
  const file = clean.split(/[\\/]/).pop() ?? '';
  const lastDot = file.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return file.slice(lastDot + 1).toLowerCase();
}

/**
 * File icon component providing brand-colored, crisp vector glyphs for programming languages and file formats.
 * e.g. React atom in cyan for .tsx/.jsx, TypeScript in blue, Python in blue/yellow, etc.
 */
export function FileIcon({ path, className = 'size-3.5 shrink-0' }: { path: string; className?: string }) {
  const ext = getFileExtension(path);
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';

  // React TSX / JSX
  if (ext === 'tsx' || ext === 'jsx') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <ellipse cx="12" cy="12" rx="10" ry="4" stroke="#00d8ff" strokeWidth="1.6" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" stroke="#00d8ff" strokeWidth="1.6" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" stroke="#00d8ff" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="1.8" fill="#00d8ff" />
      </svg>
    );
  }

  // TypeScript
  if (ext === 'ts') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect width="20" height="20" x="2" y="2" rx="4" fill="#3178c6" />
        <path d="M6 9h7M9.5 9v8M14.5 14c.5.8 1.4 1.2 2.5 1.2 1.3 0 2-.6 2-1.4 0-1.8-4-1.2-4-3.2 0-1.2 1-2 2.6-2 1.2 0 2.1.4 2.7 1.2" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  // JavaScript
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect width="20" height="20" x="2" y="2" rx="4" fill="#f7df1e" />
        <path d="M8 13.5v2c0 1.2-.6 1.8-1.8 1.8-.8 0-1.4-.4-1.7-.9M13.5 14.2c.6.7 1.4 1.1 2.3 1.1 1.2 0 1.9-.6 1.9-1.3 0-1.7-3.8-1.2-3.8-3.1 0-1.1.9-1.9 2.4-1.9 1.1 0 1.9.4 2.5 1.1" stroke="#000000" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  // JSON
  if (ext === 'json') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M8 4c-1.5 0-2 1-2 2.5v2.5c0 1-.8 1.8-1.8 1.8 1 0 1.8.8 1.8 1.8V15c0 1.5.5 2.5 2 2.5M16 4c1.5 0 2 1 2 2.5v2.5c0 1 .8 1.8 1.8 1.8-1 0-1.8.8-1.8 1.8V15c0 1.5-.5 2.5-2 2.5" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Python
  if (ext === 'py') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M11.9 2c-3.1 0-4.9 1.4-4.9 3.5v2.5h5v.8H5.6C3.5 8.8 2 10.6 2 13.5c0 3.1 1.5 4.8 4.6 4.8h1.4v-2.2c0-2.3 1.9-4.2 4.2-4.2h5V9.4c0-2.1-1.8-3.5-5-3.5h-.3V2.1Z" fill="#38bdf8" />
        <path d="M12.1 22c3.1 0 4.9-1.4 4.9-3.5V16h-5v-.8h6.4c2.1 0 3.6-1.8 3.6-4.7 0-3.1-1.5-4.8-4.6-4.8h-1.4v2.2c0 2.3-1.9 4.2-4.2 4.2h-5v2.5c0 2.1 1.8 3.5 5 3.5h.3v3.9Z" fill="#eab308" />
        <circle cx="8.5" cy="5.2" r="1" fill="#ffffff" />
        <circle cx="15.5" cy="18.8" r="1" fill="#ffffff" />
      </svg>
    );
  }

  // Rust
  if (ext === 'rs') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="#f97316" strokeWidth="1.6" />
        <path d="M12 7v2m0 6v2M7 12h2m6 0h2m-7.5-3.5 1.5 1.5m4 4 1.5 1.5m-7 0 1.5-1.5m4-4 1.5-1.5" stroke="#f97316" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="12" r="3" fill="#f97316" />
      </svg>
    );
  }

  // Go
  if (ext === 'go') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect width="20" height="20" x="2" y="2" rx="4" fill="#06b6d4" />
        <path d="M6 12a3 3 0 1 1 3 3H7.5M14 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  // CSS, SCSS, SASS, LESS
  if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 3h16l-1.5 15-6.5 3-6.5-3L4 3Z" stroke="#ec4899" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 8h8M7.5 12h8.5l-.5 4-3.5 1.5-3.5-1.5" stroke="#ec4899" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // HTML
  if (ext === 'html' || ext === 'htm') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" stroke="#ea580c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Markdown
  if (ext === 'md' || ext === 'markdown') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect width="20" height="16" x="2" y="4" rx="3" stroke="#60a5fa" strokeWidth="1.6" />
        <path d="M6 14V9l2.5 3L11 9v5M17 11l-2 2.5V8M14 11l1 2.5 1-2.5" stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Shell / Bash / Terminal script
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect width="20" height="16" x="2" y="4" rx="3" stroke="#22c55e" strokeWidth="1.6" />
        <path d="m6 9 3 3-3 3M12 15h5" stroke="#22c55e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // SQL / DB
  if (ext === 'sql') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3" stroke="#0284c7" strokeWidth="1.6" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3" stroke="#0284c7" strokeWidth="1.6" />
      </svg>
    );
  }

  // Config / Env / TOML / YAML
  if (ext === 'yaml' || ext === 'yml' || ext === 'toml' || name.startsWith('.env')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 2v20M2 12h20M4 4l16 16M20 4 4 20" stroke="#a855f7" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  // Images
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="3" stroke="#c084fc" strokeWidth="1.6" />
        <path d="m3 15 5-5c.6-.6 1.4-.6 2 0l7 7M14 13l1-1c.6-.6 1.4-.6 2 0l4 4" stroke="#c084fc" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="8" r="1.5" fill="#c084fc" />
      </svg>
    );
  }

  // Default File icon
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 2H5v20h14V7Zm0 0v6h5M8 12h8M8 16h6" />
    </svg>
  );
}

/**
 * FileBadge component matching the user screenshot:
 * `( ⚛ ModelPicker.tsx )`
 * Rounded tag with file extension icon and mono-font file name.
 */
export function FileBadge({
  path,
  className = '',
  children,
  onClick,
}: {
  path: string;
  className?: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  const fileName = path.split(/[\\/]/).pop() || path;
  const content = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[7px] border border-border/50 bg-bg-elevated px-2 py-0.5 font-mono text-[12.5px] text-text shadow-sm transition-colors hover:border-border hover:bg-bg-subtle ${className}`}
      title={path}
    >
      <FileIcon path={path} className="size-3.5 shrink-0" />
      <span className="truncate">{children ?? fileName}</span>
    </span>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="inline-flex cursor-pointer text-left">
        {content}
      </button>
    );
  }

  return content;
}
