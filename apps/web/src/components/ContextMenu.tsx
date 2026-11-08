import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/index.ts';

export type ContextItem = {
  label: string;
  danger?: boolean;
  /** Ask once more before running (the question), for something that cannot be undone. */
  confirm?: string;
  onSelect: () => void;
};

/** A right-click menu at the pointer, kept inside the window. Esc, a click elsewhere or scrolling closes it. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [asking, setAsking] = useState<ContextItem | null>(null);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) });
  }, [x, y, asking]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const run = (item: ContextItem) => {
    if (item.confirm && asking !== item) return setAsking(item);
    onClose();
    item.onSelect();
  };

  return createPortal(
    <div ref={ref} role="menu" className="context-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {asking ? (
        <div className="px-1 pt-1">
          <p className="px-2.5 pb-2 text-[13px] text-text">{asking.confirm}</p>
          <div className="flex gap-1.5 px-1 pb-1">
            <button type="button" className="question-skip flex-1" onClick={() => setAsking(null)}>
              {t('menu.cancel')}
            </button>
            <button type="button" role="menuitem" className="context-danger flex-1" onClick={() => run(asking)}>
              {asking.label}
            </button>
          </div>
        </div>
      ) : (
        items.map((item) => (
          <button key={item.label} type="button" role="menuitem" className={`profile-item ${item.danger ? 'context-danger-item' : ''}`} onClick={() => run(item)}>
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
