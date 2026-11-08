import { memo } from 'react';
import type { FormAnswer } from '@somecode/protocol';
import type { Item } from '../lib/sessionState.ts';
import { AgentMessage } from './items/AgentMessage.tsx';
import { ErrorCard } from './items/ErrorCard.tsx';
import { PermissionCard } from './items/PermissionCard.tsx';
import { ThinkingBlock } from './items/ThinkingBlock.tsx';
import { ToolCard } from './items/ToolCard.tsx';
import { UnsupportedRow } from './items/UnsupportedRow.tsx';
import { UserMessage } from './items/UserMessage.tsx';

export type ItemRowProps = {
  item: Item;
  /** Only meaningful for a thought; `false` for every other kind. */
  live: boolean;
  /** Only meaningful for a permission; `false` for every other kind. */
  answered: boolean;
  /** Must be referentially stable (the list passes a ref-backed callback). */
  onRespond: (requestId: string, optionId: string | null, answer?: FormAnswer) => void;
  /** A tool card or finished thought the user opened; `false` for every other kind. Kept by the list. */
  expanded: boolean;
  /** Toggles `expanded` for an item key. Must be referentially stable. */
  onToggle: (key: string) => void;
  /** The agent's sign-in command; shown under an `auth_required` failure. */
  signInHint?: string;
};

/**
 * One conversation item, by kind. Memoised on its (shallow) props: the reducer keeps unchanged items by
 * reference and `live`/`answered` are booleans, so streaming into the last item re-renders that row only
 * (and e.g. `ToolCard`'s diff cache is not churned by every parent render).
 */
export const ItemRow = memo(function ItemRow({ item, live, answered, onRespond, expanded, onToggle, signInHint }: ItemRowProps) {
  const toggle = () => onToggle(item.key);
  switch (item.kind) {
    case 'user': {
      const isSubagentContinue =
        item.text.startsWith('Alt ajan') ||
        item.text.startsWith('Sub-agent') ||
        item.text.includes('incelemeyi tamamladı') ||
        item.text.includes('completed their tasks');
      if (isSubagentContinue) return null;
      return <UserMessage text={item.text} images={item.images} local={item.local === true} />;
    }
    case 'agent':
      return <AgentMessage text={item.text} />;
    case 'thought':
      return <ThinkingBlock item={item} live={live} expanded={expanded} onToggle={toggle} />;
    case 'tool':
      return <ToolCard item={item} expanded={expanded} onToggle={toggle} />;
    case 'permission':
      return <PermissionCard item={item} answered={answered} onRespond={onRespond} />;
    case 'error':
      return <ErrorCard code={item.code} {...(signInHint ? { signInHint } : {})} />;
    case 'unsupported':
      return <UnsupportedRow sessionUpdate={item.sessionUpdate} />;
  }
});
