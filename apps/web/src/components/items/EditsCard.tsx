import { useId, useState } from 'react';
import { plural, t } from '../../i18n/index.ts';
import type { EditedFile } from '../../lib/edits.ts';
import { Collapse } from '../Collapse.tsx';
import { ChevronIcon } from '../icons.tsx';
import { SymbolIcon } from '../SymbolIcon.tsx';
import { FileIcon } from '../FileIcon.tsx';

/** Files shown before "show N more files". */
const VISIBLE = 3;

function FileRow({ file }: { file: EditedFile }) {
  const cut = file.path.lastIndexOf('/') + 1;
  return (
    <li className="edits-row">
      <span className="flex min-w-0 flex-1 items-center gap-1.5" title={file.path}>
        <FileIcon path={file.path} className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate text-text-muted">{file.path.slice(0, cut)}</span>
        <span className="shrink-0 font-medium text-text">{file.path.slice(cut)}</span>
      </span>
      <span className="ml-auto shrink-0 font-mono text-xs">
        <span aria-hidden="true">
          <span className="text-success">+{file.added}</span> <span className="text-danger">-{file.removed}</span>
        </span>
        <span className="sr-only">
          {t('diff.stats', { added: plural('diff.added', file.added), removed: plural('diff.removed', file.removed) })}
        </span>
      </span>
    </li>
  );
}

/**
 * The summary the agent leaves after a turn that changed files: how many, the first few with their line counts
 * (the rest unfold), and a button that opens the matching tool cards with their diffs.
 */
export function EditsCard({ files, onView }: { files: EditedFile[]; onView: () => void }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const head = files.slice(0, VISIBLE);
  const rest = files.slice(VISIBLE);
  return (
    <section aria-label={t('edits.label')} className="edits-card font-ui">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="edits-badge">
          <SymbolIcon name="diff" className="size-[18px]" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium text-text">{plural('edits.title', files.length)}</p>
        <button type="button" onClick={onView} className="edits-button">
          {t('edits.view')}
        </button>
      </div>
      <ul className="border-t border-border py-1.5">
        {head.map((f) => (
          <FileRow key={f.path} file={f} />
        ))}
      </ul>
      {rest.length > 0 && (
        <>
          <Collapse id={listId} open={all}>
            <ul className="border-t border-border py-1.5">
              {rest.map((f) => (
                <FileRow key={f.path} file={f} />
              ))}
            </ul>
          </Collapse>
          <button type="button" aria-expanded={all} aria-controls={listId} onClick={() => setAll((v) => !v)} className="edits-more">
            {all ? t('edits.less') : plural('edits.more', rest.length)}
            <ChevronIcon className={`size-3 motion-safe:transition-transform motion-safe:duration-300 ${all ? '-rotate-90' : 'rotate-90'}`} />
          </button>
        </>
      )}
    </section>
  );
}
