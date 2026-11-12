import type { ConfigOption } from '@somecode/protocol';
import { t } from '../i18n/index.ts';
import { chipLabel, chipOrder, isEffortOption, isPrimaryOption, localizeModeOptions } from '../lib/configChips.ts';
import { Menu } from './Menu.tsx';
import { ApprovalPicker } from './ApprovalPicker.tsx';
import { ModelPicker } from './ModelPicker.tsx';

/**
 * One chip per option the agent reports (mode, model, effort, …). The shown value is always what the agent last
 * confirmed: choosing sends a request and the chip stays `busy` until the new list arrives (or an error does).
 */
export function ConfigChips({
  options,
  disabled,
  pendingId,
  onChange,
  advanced = true,
}: {
  options: readonly ConfigOption[] | null;
  disabled: boolean;
  pendingId: string | null;
  onChange: (configId: string, value: string) => void;
  /** Also show the extra pickers (e.g. Agent), not just mode, model and effort. */
  advanced?: boolean;
}) {
  const ordered = chipOrder(options ? localizeModeOptions(options) : options).filter((o) => advanced || isPrimaryOption(o));
  if (ordered.length === 0) return null;

  // Model and effort share one control (the card with the slider) when the agent reports both.
  const model = ordered.find((o) => o.category === 'model');
  const effort = ordered.find(isEffortOption);
  const merged = model ? { model, effort } : null;
  const approval = ordered.find((o) => o.category === 'approval');
  const rest = ordered.filter((o) => o !== approval && (!merged || (o !== merged.model && o !== merged.effort)));

  return (
    <div role="group" aria-label={t('config.group')} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 font-ui text-xs">
      {approval && (
        <ApprovalPicker option={approval} disabled={disabled} busy={pendingId === approval.id} onChange={(value) => onChange(approval.id, value)} />
      )}
      {rest.map((option, index) => {
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
      {merged && (
        <div className="ml-auto">
          <ModelPicker model={merged.model} {...(merged.effort ? { effort: merged.effort } : {})} disabled={disabled} pendingId={pendingId} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
