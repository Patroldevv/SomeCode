import { useId, useState } from 'react';
import { plural, t } from '../i18n/index.ts';
import type { EditedFile } from '../lib/edits.ts';
import { Collapse } from './Collapse.tsx';
import { ChevronIcon } from './icons.tsx';
import { DiffView } from './items/DiffView.tsx';
import { FileIcon } from './FileIcon.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

function ChangedFile({
  file,
  defaultOpen,
  onRevertFile,
}: {
  file: EditedFile;
  defaultOpen: boolean;
  onRevertFile?: (file: EditedFile) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const cut = file.path.lastIndexOf('/') + 1;
  return (
    <li className="changes-file">
      <div className="flex items-center w-full">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="changes-head flex-1 min-w-0">
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
        {onRevertFile && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRevertFile(file);
            }}
            title={t('edits.rollbackFile')}
            className="p-1.5 mr-2 rounded text-text-muted hover:text-danger hover:bg-bg-subtle transition-colors shrink-0"
          >
            <SymbolIcon name="undo" className="size-3.5" />
          </button>
        )}
      </div>
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
export function ChangesList({
  files,
  onRevertFile,
  onRevertAll,
}: {
  files: readonly EditedFile[];
  onRevertFile?: (file: EditedFile) => void;
  onRevertAll?: () => void;
}) {
  if (files.length === 0) {
    return <div className="panel-empty">{t('panel.noChanges')}</div>;
  }
  return (
    <div className="flex flex-col h-full">
      {onRevertAll && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-subtle/50 text-xs shrink-0">
          <span className="text-text-muted font-medium">{plural('edits.title', files.length)}</span>
          <button
            type="button"
            onClick={onRevertAll}
            className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-danger transition-colors font-medium px-2 py-1 rounded hover:bg-bg"
            title={t('edits.rollbackAll')}
          >
            <SymbolIcon name="undo" className="size-3" />
            <span>{t('edits.rollbackAll')}</span>
          </button>
        </div>
      )}
      <ul className="py-1 overflow-auto flex-1">
        {files.map((file, i) => (
          <ChangedFile key={file.path} file={file} defaultOpen={i === 0} onRevertFile={onRevertFile} />
        ))}
      </ul>
    </div>
  );
}
