import type { ConfigOption } from '@somecode/protocol';
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n/index.ts';
import { isEffortOption, isModelOption } from '../lib/configChips.ts';
import { ModelPicker } from './ModelPicker.tsx';

/** The saved value if the agent really offers it, else what the agent itself currently has. */
function withSaved(option: ConfigOption, saved: string | undefined): ConfigOption {
  return saved && option.choices.some((c) => c.value === saved) ? { ...option, currentValue: saved } : option;
}

/**
 * The model and effort of a helper sub-agent, picked in the same card as in the message box and from what the
 * agent really offers (asked with a prompt-free handshake, so it costs nothing). `model` and `effort` are the saved
 * choices; one the agent does not know (any more) shows the agent's own current value instead.
 */
export function SubagentModelPicker({
  agentId,
  model,
  effort,
  disabled,
  loadOptions,
  onChange,
}: {
  agentId: string;
  model: string | undefined;
  effort: string | undefined;
  disabled: boolean;
  loadOptions: (agentId: string) => Promise<ConfigOption[]>;
  onChange: (patch: { model?: string; effort?: string }) => void;
}) {
  const [options, setOptions] = useState<ConfigOption[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setOptions(null);
    void loadOptions(agentId)
      .then((o) => alive && setOptions(o))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [agentId, loadOptions, attempt]);

  const picked = useMemo(() => {
    const modelOption = options?.find(isModelOption);
    const effortOption = options?.find((o) => o !== modelOption && isEffortOption(o));
    return modelOption ? { model: withSaved(modelOption, model), effort: effortOption ? withSaved(effortOption, effort) : undefined } : null;
  }, [options, model, effort]);

  if (options === null) return <span className="text-[13px] text-text-muted" role="status">{t('chat.loading')}</span>;
  if (!picked) {
    return (
      <span className="flex items-center gap-2 text-[13px] text-text-muted">
        {t('settings.subagent.noOptions')}
        <button type="button" className="question-skip" onClick={() => setAttempt((n) => n + 1)}>
          {t('agent.refresh')}
        </button>
      </span>
    );
  }
  return (
    <ModelPicker
      model={picked.model}
      {...(picked.effort ? { effort: picked.effort } : {})}
      disabled={disabled}
      pendingId={null}
      placement="down"
      onChange={(configId, value) => onChange(configId === picked.model.id ? { model: value } : { effort: value })}
    />
  );
}
