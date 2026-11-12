import type { ReactNode, SVGProps } from 'react';
import { ArrowLeftRight, ArrowRight, Check, ChevronRight, CircleAlert, FileText, Globe, Lightbulb, PanelLeft, Pencil, Search, ShieldCheck, SquareTerminal, Trash2, Wrench, X, type LucideIcon } from 'lucide-react';

// Small inline line icons (16 × 16, `currentColor`), decorative by default: callers give the accessible name.

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function Icon({ children, className = 'size-4', ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** The line icons come from the Lucide set (one consistent drawing style); the size and colour are the caller's. */
function lucide(Component: LucideIcon, name?: string) {
  return function GlyphIcon({ className = 'size-4', ...rest }: IconProps) {
    return <Component aria-hidden="true" focusable="false" strokeWidth={1.75} className={className} {...(name ? { 'data-icon': name } : {})} {...(rest as object)} />;
  };
}

export const FileIcon = lucide(FileText, 'file');

export const PencilIcon = lucide(Pencil, 'edit');

export const TrashIcon = lucide(Trash2, 'trash');

export const MoveIcon = lucide(ArrowRight);

export const SearchIcon = lucide(Search, 'search');

export const TerminalIcon = lucide(SquareTerminal, 'terminal');

export const BulbIcon = lucide(Lightbulb, 'idea');

export const GlobeIcon = lucide(Globe, 'globe');

export const SwitchIcon = lucide(ArrowLeftRight);

export const WrenchIcon = lucide(Wrench, 'tool');

export const CheckIcon = lucide(Check);

export const CrossIcon = lucide(X, 'close');

export const ChevronIcon = lucide(ChevronRight);

export const ShieldIcon = lucide(ShieldCheck, 'shield');

export const AlertIcon = lucide(CircleAlert);

/** Filled dot (neutral status, bullets). */
export const DotIcon = ({ className = 'size-4', ...rest }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={className} {...rest}>
    <circle cx="8" cy="8" r="2.5" fill="currentColor" />
  </svg>
);

/** Hollow ring (pending plan entry). */
export const RingIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5" />
  </Icon>
);

/** Ring with a filled half (in-progress plan entry). */
export const HalfRingIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5" />
    <path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor" stroke="none" />
  </Icon>
);

/** Gives a decorative icon an accessible name (`role="img"`) and a tooltip (`title`, defaults to the name). */
export function Glyph({ label, title, className = '', children }: { label: string; title?: string; className?: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={label} title={title ?? label} className={`inline-flex shrink-0 ${className}`}>
      {children}
    </span>
  );
}

/**
 * A busy indicator with `role="status"` and an accessible name. Under `prefers-reduced-motion` the rotating arc
 * is replaced by a static ellipsis glyph.
 */
export function Spinner({ label, className = 'size-4' }: { label: string; className?: string }) {
  return (
    <span role="status" aria-label={label} title={label} className={`inline-flex shrink-0 ${className}`}>
      <span aria-hidden="true" className="spin-arc size-full motion-reduce:hidden" />
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="hidden size-full motion-reduce:block">
        <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
        <circle cx="8" cy="8" r="1.25" fill="currentColor" />
        <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
      </svg>
    </span>
  );
}

/** A panel with a left column (sidebar toggle). */
export const SidebarIcon = lucide(PanelLeft, 'panel');
