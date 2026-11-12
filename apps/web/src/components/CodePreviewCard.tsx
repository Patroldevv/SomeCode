import { useState, useRef, useEffect } from 'react';
import { LIGHT_THEMES, DARK_THEMES, findTheme, type ThemeDef } from '../lib/codeTheme.ts';
import { SymbolIcon } from './SymbolIcon.tsx';

function ThemeDropdown({
  selected,
  themes,
  onChange,
}: {
  selected: string;
  themes: ThemeDef[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTheme = themes.find((t) => t.id === selected) ?? themes[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-bg-elevated px-3 py-2 text-[13.5px] font-medium text-text transition-colors hover:border-text-muted focus-visible:outline-2 focus-visible:outline-accent"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{activeTheme.label}</span>
        <SymbolIcon name="chevron" className={`size-3.5 text-text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-64 w-full min-w-[200px] overflow-y-auto rounded-xl border border-border bg-bg-elevated p-1 shadow-xl backdrop-blur-md"
        >
          {themes.map((theme) => {
            const isSelected = theme.id === activeTheme.id;
            return (
              <button
                key={theme.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(theme.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors ${
                  isSelected ? 'bg-bg-subtle font-medium text-text' : 'text-text-muted hover:bg-bg-subtle hover:text-text'
                }`}
              >
                <span>{theme.label}</span>
                {isSelected && <SymbolIcon name="check" className="size-3.5 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiffSnippet({ theme, isLight }: { theme: ThemeDef; isLight: boolean }) {
  return (
    <div
      className="relative mt-2.5 overflow-hidden rounded-xl border border-border/70 p-3.5 font-mono text-[12px] leading-relaxed select-none transition-all duration-200"
      style={{
        backgroundColor: theme.bg,
        color: theme.fg,
        boxShadow: isLight ? '0 1px 3px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.3)',
      }}
    >
      {/* Line 1: Normal */}
      <div className="flex items-center gap-3">
        <span className="w-4 select-none text-right text-[11px]" style={{ color: theme.lineNum }}>
          1
        </span>
        <div className="truncate">
          <span style={{ color: theme.keyword }}>function</span> <span style={{ color: theme.fn }}>greet</span>
          <span>(</span>
          <span style={{ color: theme.param }}>name</span>
          <span>: </span>
          <span style={{ color: theme.type }}>string</span>
          <span>) {'{'}</span>
        </div>
      </div>

      {/* Line 2: Removed (-) */}
      <div
        className="relative -mx-3.5 my-0.5 flex items-center gap-3 px-3.5 py-0.5"
        style={{
          backgroundColor: theme.delBg,
        }}
      >
        <span
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: theme.delBorder }}
        />
        <span className="flex w-4 select-none items-center justify-end gap-1 text-[11px]" style={{ color: theme.lineNum }}>
          <span>2</span>
          <span className="text-[10px] font-bold" style={{ color: theme.delBorder }}>-</span>
        </span>
        <div className="truncate pl-3">
          <span style={{ color: theme.keyword }}>return</span> <span style={{ color: theme.string }}>"Hello, "</span> <span>+</span> <span style={{ color: theme.param }}>name</span>
          <span>;</span>
        </div>
      </div>

      {/* Line 2: Added (+) */}
      <div
        className="relative -mx-3.5 my-0.5 flex items-center gap-3 px-3.5 py-0.5"
        style={{
          backgroundColor: theme.addBg,
        }}
      >
        <span
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: theme.addBorder }}
        />
        <span className="flex w-4 select-none items-center justify-end gap-1 text-[11px]" style={{ color: theme.lineNum }}>
          <span>2</span>
          <span className="text-[10px] font-bold" style={{ color: theme.addBorder }}>+</span>
        </span>
        <div className="truncate pl-3">
          <span style={{ color: theme.keyword }}>return</span> <span style={{ color: theme.string }}>`Hello, ${'{'}{theme.param ? 'name' : 'name'}{'}'}!`</span>
          <span>;</span>
        </div>
      </div>

      {/* Line 3: Normal */}
      <div className="flex items-center gap-3">
        <span className="w-4 select-none text-right text-[11px]" style={{ color: theme.lineNum }}>
          3
        </span>
        <div>{'}'}</div>
      </div>
    </div>
  );
}

export function CodeAppearanceSection({
  codeThemeLight,
  codeThemeDark,
  onLightChange,
  onDarkChange,
}: {
  codeThemeLight: string;
  codeThemeDark: string;
  onLightChange: (id: string) => void;
  onDarkChange: (id: string) => void;
}) {
  const lightTheme = findTheme(codeThemeLight, true);
  const darkTheme = findTheme(codeThemeDark, false);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="min-w-0">
        <ThemeDropdown selected={codeThemeLight} themes={LIGHT_THEMES} onChange={onLightChange} />
        <DiffSnippet theme={lightTheme} isLight={true} />
      </div>
      <div className="min-w-0">
        <ThemeDropdown selected={codeThemeDark} themes={DARK_THEMES} onChange={onDarkChange} />
        <DiffSnippet theme={darkTheme} isLight={false} />
      </div>
    </div>
  );
}
