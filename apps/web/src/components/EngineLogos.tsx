export type EngineId = 'google' | 'yandex' | 'bing' | 'duckduckgo' | 'brave';

export const ENGINE_LIST: { id: EngineId; name: string }[] = [
  { id: 'google', name: 'Google' },
  { id: 'yandex', name: 'Yandex' },
  { id: 'bing', name: 'Bing' },
  { id: 'duckduckgo', name: 'DuckDuckGo' },
  { id: 'brave', name: 'Brave' },
];

/** A small mark for each search engine (simplified drawings in the engine's colours; decorative). */
export function EngineLogo({ id, className = 'size-4' }: { id: EngineId; className?: string }) {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, className: `shrink-0 ${className}` } as const;
  switch (id) {
    case 'google':
      return (
        <svg {...common}>
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.87h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.97-4.32 2.97-7.34Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.41 13.91A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.91V7.51H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.49l3.34-2.58Z" />
          <path fill="#EA4335" d="M12 5.98c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.97 9.97 0 0 0 12 2 10 10 0 0 0 3.07 7.51l3.34 2.58C7.2 7.74 9.4 5.98 12 5.98Z" />
        </svg>
      );
    case 'yandex':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="#FC3F1D" />
          <path fill="#fff" d="M13.3 18.5h-1.9V13.3L8.2 5.5h2l2.2 5.6 2.1-5.6h1.9l-3.1 7.8Z" transform="translate(.3 0) scale(.98)" />
        </svg>
      );
    case 'bing':
      return (
        <svg {...common}>
          <path fill="#0C8484" d="M6 3.2 10 4.6v12.1l5.3-3.1-2.7-1.3-1.7-4.2 8.2 2.9v4.4L10 21.2 6 18.9Z" />
        </svg>
      );
    case 'duckduckgo':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="#DE5833" />
          <circle cx="12" cy="11.5" r="6.4" fill="#fff" />
          <circle cx="10.2" cy="10.4" r="1.1" fill="#2D4F8E" />
          <path fill="#FDD20A" d="M13.2 12.8c1.6-.2 3 .5 3.4 1.5-.9.9-2.7 1.2-3.9.3Z" />
        </svg>
      );
    case 'brave':
      return (
        <svg {...common}>
          <path fill="#FB542B" d="m12 2.4 6.2 2.1 1.9 3-1 3.1.9 2.4-7.4 8.6a1 1 0 0 1-1.2 0L3.9 13l.9-2.4-1-3.1 1.9-3Z" />
          <path fill="#fff" d="m12 7.6 3.1 1.1-.4 1.3-1.1 1.4 1.1.9-1 1.9-1.7 1.5-1.7-1.5-1-1.9 1.1-.9-1.1-1.4-.4-1.3Z" />
        </svg>
      );
  }
}
