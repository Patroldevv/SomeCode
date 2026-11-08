import type { ConfigOption } from '@somecode/protocol';
import { t } from '../i18n/index.ts';
import { chipLabel, chipOrder } from '../lib/configChips.ts';
import { Menu } from './Menu.tsx';

/**
 * One chip per option the agent reports (mode, model, effort, …). The shown value is always what the agent last
 * confirmed: choosing sends a request and the chip stays `busy` until the new list arrives (or an error does).
 */
export function ConfigChips({
  options,
  disabled,
  pendingId,
  onChange,
}: {
  options: readonly ConfigOption[] | null;
  disabled: boolean;
  pendingId: string | null;
  onChange: (configId: string, value: string) => void;
}) {
  const ordered = chipOrder(options);
  if (ordered.length === 0) return null;
  return (
    <div role="group" aria-label={t('config.group')} className="flex flex-wrap gap-1.5 font-ui text-xs">
      {ordered.map((option, index) => {
        const { name, value } = chipLabel(option);
        return (
          <Menu
            // Agents should not repeat ids, but a duplicate must not break rendering.
            key={`${option.id}:${index}`}
            label={t('config.chipLabel', { name, value })}
            items={option.choices}
            selected={option.currentValue}
            disabled={disabled}
            busy={pendingId === option.id}
            onSelect={(next) => onChange(option.id, next)}
          >
            <span className="text-text-muted">{name}</span>
            <span className="text-text">{value}</span>
          </Menu>
        );
      })}
    </div>
  );
}
