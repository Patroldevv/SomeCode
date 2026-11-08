import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SessionState } from '../lib/sessionState.ts';
import { SymbolIcon } from './SymbolIcon.tsx';

interface ContextStats {
  usedTokens: number;
  maxTokens: number;
  percentage: number;
  messagesTokens: number;
  mcpToolsTokens: number;
  systemToolsTokens: number;
  systemPromptTokens: number;
  skillsTokens: number;
  bufferTokens: number;
}

export function calculateContextStats(state: SessionState | null | undefined): ContextStats {
  let messageChars = 0;
  let toolChars = 0;

  if (state?.items) {
    for (const item of state.items) {
      if (item.kind === 'user' || item.kind === 'agent') {
        messageChars += item.text.length;
      } else if (item.kind === 'thought') {
        messageChars += item.text.length;
      } else if (item.kind === 'tool') {
        if (item.rawInput) {
          try {
            messageChars += JSON.stringify(item.rawInput).length;
          } catch {}
        }
        if (item.rawOutput) {
          try {
            toolChars += JSON.stringify(item.rawOutput).length;
          } catch {}
        }
        for (const block of item.content) {
          if (block.type === 'text') toolChars += block.text.length;
          else if (block.type === 'diff') toolChars += (block.newText?.length ?? 0) + (block.oldText?.length ?? 0);
        }
      }
    }
  }

  // Model context limit estimation
  const modelChoice = state?.configOptions?.find((o) => o.id === 'model')?.currentValue?.toLowerCase() ?? '';
  let maxTokens = 200_000;
  if (modelChoice.includes('gemini') || modelChoice.includes('1m')) {
    maxTokens = 1_000_000;
  } else if (modelChoice.includes('2m')) {
    maxTokens = 2_000_000;
  } else if (modelChoice.includes('128k')) {
    maxTokens = 128_000;
  }

  const messagesTokens = Math.max(120, Math.round(messageChars / 3.8));
  const mcpToolsTokens = Math.round(toolChars / 3.8);
  const systemToolsTokens = 15_500;
  const systemPromptTokens = 9_700;
  const skillsTokens = 8_100;

  // When the agent reports its real context window, that wins over the estimate above.
  const reported = state?.usage && state.usage.size > 0 ? state.usage : null;
  if (reported) maxTokens = reported.size;
  const usedTokens = reported ? reported.used : messagesTokens + mcpToolsTokens + systemToolsTokens + systemPromptTokens + skillsTokens;
  const percentage = Math.min(100, Math.max(1, Math.round((usedTokens / maxTokens) * 100)));
  const bufferTokens = Math.max(0, maxTokens - usedTokens);

  return {
    usedTokens,
    maxTokens,
    percentage,
    messagesTokens,
    mcpToolsTokens,
    systemToolsTokens,
    systemPromptTokens,
    skillsTokens,
    bufferTokens,
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextIndicator({
  state,
  onCompact,
}: {
  state?: SessionState | null;
  onCompact?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const stats = useMemo(() => calculateContextStats(state), [state]);
  const id = useId();

  // Close on click outside or Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const pColor =
    stats.percentage >= 85 ? 'text-danger bg-danger/10 border-danger/30' :
    stats.percentage >= 65 ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' :
    'text-text-muted bg-bg-elevated border-border/60 hover:text-text';

  const barColor =
    stats.percentage >= 85 ? 'bg-danger' :
    stats.percentage >= 65 ? 'bg-amber-400' :
    'bg-accent';

  return (
    <div className="relative inline-flex items-center" ref={panelRef}>
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-label={`Bağlam penceresi: %${stats.percentage} kullanıldı`}
        title={`Bağlam penceresi: %${stats.percentage} kullanıldı (${formatTokens(stats.usedTokens)} / ${formatTokens(stats.maxTokens)})`}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition cursor-pointer select-none ${pColor}`}
      >
        <div className="relative flex size-2 items-center justify-center">
          <span className={`size-1.5 rounded-full ${barColor}`} />
        </div>
        <span className="font-medium text-text">%{stats.percentage}</span>
        <span className="text-[11px] text-text-muted">
          {formatTokens(stats.usedTokens)} / {formatTokens(stats.maxTokens)}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={id}
          className="absolute right-0 top-full mt-2 w-80 sm:w-88 rounded-2xl border border-border bg-bg-elevated p-4 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border/50">
            <span className="text-sm font-semibold tracking-tight text-text">Bağlam</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1 text-text-muted transition hover:bg-bg-subtle hover:text-text"
              aria-label="Kapat"
            >
              <SymbolIcon name="close" className="size-3.5" />
            </button>
          </div>

          {/* Usage summary */}
          <div className="mt-3.5 flex items-baseline justify-between text-xs">
            <span className="text-sm font-semibold text-text">%{stats.percentage} kullanıldı</span>
            <span className="font-mono text-[11px] text-text-muted">
              {formatTokens(stats.usedTokens)} / {formatTokens(stats.maxTokens)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
            <div
              className={`h-full transition-all duration-300 rounded-full ${barColor}`}
              style={{ width: `${Math.max(2, stats.percentage)}%` }}
            />
          </div>

          {/* Auto-compact option hint */}
          <div className="mt-3.5 flex items-center justify-between text-xs text-text-muted">
            <span>Otomatik sıkıştırma eşiği</span>
            <span className="font-medium text-text">Otomatik</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted/80">
            Daha düşük bir değer kullanım sınırınıza daha erken ulaşılmasını önler ve oturumu optimize eder.
          </p>

          {/* Breakdown items */}
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex items-center justify-between text-text">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-blue-500" />
                <span>Mesajlar</span>
              </span>
              <span className="font-mono text-[11px] text-text-muted">{formatTokens(stats.messagesTokens)}</span>
            </div>

            <div className="flex items-center justify-between text-text">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-amber-500" />
                <span>Araçlar</span>
              </span>
              <span className="font-mono text-[11px] text-text-muted">{formatTokens(stats.mcpToolsTokens + stats.systemToolsTokens)}</span>
            </div>

            <div className="flex items-center justify-between text-text">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-purple-500" />
                <span>Sistem İstemi</span>
              </span>
              <span className="font-mono text-[11px] text-text-muted">{formatTokens(stats.systemPromptTokens)}</span>
            </div>

            <div className="flex items-center justify-between text-text">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-cyan-500" />
                <span>Beceriler (Skills)</span>
              </span>
              <span className="font-mono text-[11px] text-text-muted">{formatTokens(stats.skillsTokens)}</span>
            </div>

            <div className="flex items-center justify-between text-text border-t border-border/40 pt-2">
              <span className="flex items-center gap-2 text-text-muted">
                <span className="size-2 rounded-full bg-gray-600" />
                <span>Boş alan (Buffer)</span>
              </span>
              <span className="font-mono text-[11px] text-text-muted">{formatTokens(stats.bufferTokens)}</span>
            </div>
          </div>

          {/* Compact Button */}
          {onCompact && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCompact();
              }}
              className="mt-4 w-full rounded-xl border border-border bg-bg-subtle py-2 text-xs font-medium text-text transition hover:bg-bg-elevated hover:border-border/80"
            >
              Oturumu Sıkıştır (/compact)
            </button>
          )}
        </div>
      )}
    </div>
  );
}