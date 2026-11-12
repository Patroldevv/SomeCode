import { createContext, useContext, useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { ScreenshotThumb } from './items/ScreenshotThumb.tsx';

export type LocalImageLoader = (path: string) => Promise<{ data: string; mimeType: string } | null>;

const Loader = createContext<LocalImageLoader | null>(null);
export const LocalImageProvider = Loader.Provider;

/** A picture an agent mentioned by its file path: fetched from SomeCode (which checks the place), shown like a screenshot. */
export function LocalImage({ path, alt }: { path: string; alt: string }) {
  const load = useContext(Loader);
  const [state, setState] = useState<'loading' | 'failed' | { data: string; mimeType: string }>('loading');
  useEffect(() => {
    if (!load) return setState('failed');
    let alive = true;
    setState('loading');
    void load(path)
      .then((image) => alive && setState(image ?? 'failed'))
      .catch(() => alive && setState('failed'));
    return () => {
      alive = false;
    };
  }, [load, path]);
  if (state === 'loading') return <span className="inline-flex items-center gap-2 text-text-muted"><span className="spin-arc size-3" aria-hidden="true" />{alt || t('tool.screenshot')}</span>;
  if (state === 'failed') return alt ? <span className="text-text-muted">{alt}</span> : null;
  return (
    <span className="my-1 block">
      <ScreenshotThumb data={state.data} mimeType={state.mimeType} caption={alt || path.split('/').pop() || ''} />
    </span>
  );
}
