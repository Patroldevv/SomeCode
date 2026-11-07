import type { ComponentType, SVGProps } from 'react';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  BulbIcon,
  CheckIcon,
  CrossIcon,
  DotIcon,
  FileIcon,
  Glyph,
  GlobeIcon,
  MoveIcon,
  PencilIcon,
  SearchIcon,
  Spinner,
  SwitchIcon,
  TerminalIcon,
  TrashIcon,
  WrenchIcon,
} from '../icons.tsx';

type IconComponent = ComponentType<Omit<SVGProps<SVGSVGElement>, 'children'>>;

/** ACP tool kinds; anything else (including `other`) falls back to the generic tool icon. */
const KINDS = new Map<string, readonly [IconComponent, MessageKey]>([
  ['read', [FileIcon, 'tool.kind.read']],
  ['edit', [PencilIcon, 'tool.kind.edit']],
  ['delete', [TrashIcon, 'tool.kind.delete']],
  ['move', [MoveIcon, 'tool.kind.move']],
  ['search', [SearchIcon, 'tool.kind.search']],
  ['execute', [TerminalIcon, 'tool.kind.execute']],
  ['think', [BulbIcon, 'tool.kind.think']],
  ['fetch', [GlobeIcon, 'tool.kind.fetch']],
  ['switch_mode', [SwitchIcon, 'tool.kind.switch_mode']],
]);

export function toolKindLabel(kind: string): string {
  return t(KINDS.get(kind)?.[1] ?? 'tool.kind.other');
}

export function ToolKindIcon({ kind }: { kind: string }) {
  const Icon = KINDS.get(kind)?.[0] ?? WrenchIcon;
  return (
    <Glyph label={toolKindLabel(kind)}>
      <Icon className="size-3.5" />
    </Glyph>
  );
}

/**
 * pending / in_progress → spinner (`role="status"`), completed → check, failed → cross; every one named from
 * i18n. An unknown status is a neutral dot whose raw value is only a tooltip.
 */
export function ToolStatus({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Spinner label={t('tool.status.pending')} className="size-3.5 text-text-muted" />;
    case 'in_progress':
      return <Spinner label={t('tool.status.in_progress')} className="size-3.5 text-accent" />;
    case 'completed':
      return (
        <Glyph label={t('tool.status.completed')} className="text-success">
          <CheckIcon className="size-3.5" />
        </Glyph>
      );
    case 'failed':
      return (
        <Glyph label={t('tool.status.failed')} className="text-danger">
          <CrossIcon className="size-3.5" />
        </Glyph>
      );
    default:
      return (
        <Glyph label={t('tool.status.unknown')} title={status} className="text-text-muted">
          <DotIcon className="size-3.5" />
        </Glyph>
      );
  }
}
