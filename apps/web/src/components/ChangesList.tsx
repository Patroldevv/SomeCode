import { useId, useState } from 'react';
import { plural, t } from '../i18n/index.ts';
import type { EditedFile } from '../lib/edits.ts';
import { Collapse } from './Collapse.tsx';
import { ChevronIcon } from './icons.tsx';
import { DiffView } from './items/DiffView.tsx';
import { FileIcon } from './FileIcon.tsx';

function ChangedFile({ file, defaultOpen }: { file: EditedFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const cut = file.path.lastIndexOf('/') + 1;
  return (
    <li className="changes-file">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="changes-head">
        <ChevronIcon className={`size-3 shrink-0 text-text-muted motion-safe:transition-transform motion-safe:duration-300 ${open ? 'rotate-90' : ''}`} />
        <FileIcon path={file.path} className="size-3.5 shrink-0" />
        <span className="flex min-w-0 flex-1 text-left" title={file.path}>
          <span className="min-w-0 truncate text-text-muted">{file.path.slice(0, cut)}</span>
          <span className="shrink-0 font-medium text-text">{file.path.slice(cut)}</span>
        </span>
        <span className="shrink-0 font-mono text-xs">
          <span aria-hidden="true">
            <span className="text-success">+{file.added}</span> <span className="text-danger">-{file.removed}</span>
          </span>
          <span className="sr-only">
            {t('diff.stats', { added: plural('diff.added', file.added), removed: plural('diff.removed', file.removed) })}
          </span>
        </span>
      </button>
      <Collapse id={id} open={open}>
        <div className="flex flex-col gap-2 px-3 pb-3">
          {file.changes.map((change, i) => (
            <DiffView key={i} path={file.path} oldText={change.oldText} newText={change.newText} />
          ))}
        </div>
      </Collapse>
    </li>
  );
}

/** The files the agent changed in this session; each unfolds into its diff (the first one starts open). */
export function ChangesList({ files }: { files: readonly EditedFile[] }) {
  if (files.length === 0) {
    return <div className="panel-empty">{t('panel.noChanges')}</div>;
  }
  return (
    <ul className="py-1">
      {files.map((file, i) => (
        <ChangedFile key={file.path} file={file} defaultOpen={i === 0} />
      ))}
    </ul>
  );
}
