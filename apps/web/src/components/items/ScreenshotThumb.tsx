import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n/index.ts';
import { SymbolIcon } from '../SymbolIcon.tsx';

/** A screenshot an agent took, shown in the conversation itself: a thumbnail that opens full size on a press. */
export function ScreenshotThumb({ data, mimeType, caption }: { data: string; mimeType: string; caption?: string }) {
  const [big, setBig] = useState(false);
  const src = `data:${mimeType};base64,${data}`;
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setBig(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  return (
    <>
      <button type="button" onClick={() => setBig(true)} title={t('tool.openImage')} className="screenshot-thumb">
        <img src={src} alt={caption ?? t('tool.screenshot')} loading="lazy" />
      </button>
      {big &&
        typeof document !== 'undefined' &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label={caption ?? t('tool.screenshot')} className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-md" onClick={() => setBig(false)}>
            <button type="button" onClick={() => setBig(false)} aria-label={t('error.dismiss')} className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white">
              <SymbolIcon name="close" className="size-4" />
            </button>
            <img src={src} alt={caption ?? t('tool.screenshot')} className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()} />
            {caption && <p className="mt-3 max-w-[92vw] truncate text-sm text-white/70">{caption}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
