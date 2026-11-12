import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/index.ts';
import type { EditedFile } from '../lib/edits.ts';
import { FileIcon } from './FileIcon.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

export function ConfirmUndoDialog({
  open,
  files = [],
  hasFileEdits = files.length > 0,
  onClose,
  onConfirm,
}: {
  open: boolean;
  files?: readonly EditedFile[];
  hasFileEdits?: boolean;
  onClose: () => void;
  onConfirm: (revertFiles: boolean) => void | Promise<void>;
}) {
  const [revertFiles, setRevertFiles] = useState(hasFileEdits);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setRevertFiles(hasFileEdits);
      setLoading(false);
    }
  }, [open, hasFileEdits]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !loading) {
        e.preventDefault();
        void handleConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, loading, revertFiles]);

  if (!open || typeof document === 'undefined') return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(revertFiles);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-undo-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[460px] rounded-2xl bg-bg-elevated border border-border/80 p-6 shadow-2xl text-text font-ui"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2">
          <h2 id="confirm-undo-title" className="text-base font-semibold text-text tracking-tight">
            {t('undo.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('error.dismiss')}
            className="rounded-lg p-1 text-text-muted hover:text-text hover:bg-bg-subtle transition-colors"
          >
            <SymbolIcon name="close" className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="py-2 text-sm text-text-muted leading-relaxed">
          <p>
            {hasFileEdits ? t('undo.hasEditsDescription') : t('undo.noEditsDescription')}
          </p>

          <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none text-text text-sm">
            <input
              type="checkbox"
              checked={revertFiles}
              onChange={(e) => setRevertFiles(e.target.checked)}
              className="size-4 rounded border-border bg-bg-subtle text-accent accent-accent cursor-pointer"
            />
            <span>{t('undo.revertCheckbox')}</span>
          </label>

          {/* Revertable Files List */}
          {revertFiles && files.length > 0 && (
            <div
              role="list"
              aria-label={t('edits.label')}
              className="mt-3.5 max-h-56 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden flex flex-col gap-2 py-1 pr-1"
            >
              {files.map((file) => {
                const name = file.path.split(/[\\/]/).pop() ?? file.path;
                return (
                  <div
                    key={file.path}
                    role="listitem"
                    className="flex items-center gap-2 text-sm select-none"
                    title={file.path}
                  >
                    <FileIcon path={file.path} className="size-4 shrink-0" />
                    <span className="truncate text-text text-[13.5px] font-normal leading-none">
                      {name}
                    </span>
                    <span className="text-emerald-400 font-mono text-[12.5px] font-medium shrink-0 leading-none">
                      +{file.removed}
                    </span>
                    <span className="text-rose-400 font-mono text-[12.5px] font-medium shrink-0 leading-none">
                      -{file.added}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3.5 py-1.5 text-sm font-medium text-text-muted hover:text-text transition-colors"
          >
            {t('undo.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full bg-text text-bg hover:opacity-90 active:scale-95 transition-all shadow-sm"
          >
            {loading && <span className="loading-ring size-3 border-[1.5px]" />}
            <span>{t('undo.confirm')} ↵</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
