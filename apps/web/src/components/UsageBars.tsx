import { t } from '../i18n/index.ts';
import type { AgentLimit, AgentUsage } from '../lib/api.ts';
import { compactTokens } from '../lib/usageStats.ts';
import { percentLeft, resetLabel, rowName, toneOf, untilLabel } from '../lib/usageFormat.ts';

/** One window of an agent as a bar that shows how much is left, with its name, the figure and when it renews. */
export function LimitBar({ limit, now }: { limit: AgentLimit; now: number }) {
  const expired = limit.resetsAt !== null && limit.resetsAt < now;
  const left = percentLeft(limit, now);
  const tone = toneOf(left);
  const name = rowName(limit);
  return (
    <li className="limit-bar" data-tone={tone}>
      <div className="limit-top">
        <span className="limit-name">{name}</span>
        <span className="limit-left">{left !== null ? t('usage.left', { percent: left }) : expired ? t('usage.renewed') : t('usage.unknown')}</span>
      </div>
      <div className="limit-track" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} {...(left !== null ? { 'aria-valuenow': left } : {})}>
        <span className="limit-fill" style={{ width: `${left ?? (expired ? 100 : 0)}%` }} />
      </div>
      {limit.resetsAt !== null && !expired && (
        <div className="limit-reset">
          <span>{t('usage.resets', { when: resetLabel(limit.resetsAt, now) })}</span>
          <span className="limit-until">{untilLabel(limit.resetsAt, now)}</span>
        </div>
      )}
    </li>
  );
}

/** Everything one agent can tell about its usage: its windows as bars, plain figures, or why it cannot say. */
export function AgentUsageBlock({ agent, now }: { agent: AgentUsage; now: number }) {
  return (
    <section className="usage-agent" aria-label={agent.label}>
      <h3>{agent.label}</h3>
      {agent.limits.length > 0 && (
        <ul className="limit-list">
          {agent.limits.map((l) => (
            <LimitBar key={l.type} limit={l} now={now} />
          ))}
        </ul>
      )}
      {agent.stats && agent.stats.length > 0 && (
        <p className="usage-empty">
          {t('usage.stats7d', {
            prompts: agent.stats.find((s) => s.key === 'prompts7d')?.value ?? 0,
            tokens: compactTokens(agent.stats.find((s) => s.key === 'tokens7d')?.value ?? 0),
          })}
        </p>
      )}
      {agent.error && <p className="usage-empty">{t(agent.error === 'signed_out' ? 'usage.signedOut' : 'usage.unavailable')}</p>}
      {agent.limits.length === 0 && !agent.stats && !agent.error && <p className="usage-empty">{t('usage.none')}</p>}
    </section>
  );
}
