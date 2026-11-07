import type { ReactNode, SVGProps } from 'react';

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

export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 1.75h5L12.25 5v9.25H4z" />
    <path d="M9 1.75V5h3.25M6 8.5h4M6 11h4" />
  </Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.5 2.5l3 3-8 8H2.5v-3z" />
    <path d="M9 4l3 3" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.75 9.5h6.5L12 4" />
  </Icon>
);

export const MoveIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 8h11M9.5 4.5L13 8l-3.5 3.5" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L14 14" />
  </Icon>
);

export const TerminalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4l3.5 4-3.5 4M8 12.5h5.5" />
  </Icon>
);

export const BulbIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 12h4M6.5 14.25h3M5.75 10A4.25 4.25 0 1 1 10.25 10c-.5.4-.75.9-.75 1.5v.5h-3v-.5c0-.6-.25-1.1-.75-1.5z" />
  </Icon>
);

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M1.75 8h12.5M8 1.75c1.75 1.75 2.5 3.9 2.5 6.25S9.75 12.5 8 14.25C6.25 12.5 5.5 10.35 5.5 8S6.25 3.5 8 1.75z" />
  </Icon>
);

export const SwitchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 5.5h10L10 3M13.5 10.5h-10L6 13" />
  </Icon>
);

export const WrenchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2a3.5 3.5 0 0 0-3.2 4.9L2.25 11.45a1.6 1.6 0 0 0 2.3 2.3L9.1 9.2A3.5 3.5 0 0 0 14 6l-2.1 2.1-2.4-.6-.6-2.4L11 3z" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5l3.25 3.25L13 4.75" />
  </Icon>
);

export const CrossIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.75l5.25 2v4c0 3.25-2.25 5.5-5.25 6.5-3-1-5.25-3.25-5.25-6.5v-4z" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.75v3.75M8 11.1v.15" />
  </Icon>
);

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
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="size-full motion-safe:animate-spin motion-reduce:hidden"
      >
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
        <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="hidden size-full motion-reduce:block">
        <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
        <circle cx="8" cy="8" r="1.25" fill="currentColor" />
        <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
      </svg>
    </span>
  );
}
