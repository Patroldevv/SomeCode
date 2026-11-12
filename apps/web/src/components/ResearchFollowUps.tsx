import { t, type MessageKey } from '../i18n/index.ts';
import { SymbolIcon, type SymbolName } from './SymbolIcon.tsx';

const FOLLOW_UPS: { key: string; icon: SymbolName }[] = [
  { key: 'deeper', icon: 'research' },
  { key: 'refute', icon: 'shield' },
  { key: 'verify', icon: 'checkCircle' },
  { key: 'gaps', icon: 'search' },
  { key: 'table', icon: 'diff' },
  { key: 'brief', icon: 'steps' },
];

/** After a research report: one press sends the next question (go deeper, refute, check the sources, fill gaps, make a table, shorten). */
export function ResearchFollowUps({ onPick, disabled = false }: { onPick: (text: string) => void; disabled?: boolean }) {
  return (
    <div className="research-followups" role="group" aria-label={t('followup.label')}>
      <span className="research-followups-label">{t('followup.label')}</span>
      {FOLLOW_UPS.map((f) => (
        <button key={f.key} type="button" className="research-starter" disabled={disabled} onClick={() => onPick(t(`followup.${f.key}.prompt` as MessageKey))}>
          <SymbolIcon name={f.icon} className="size-3.5" />
          {t(`followup.${f.key}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}
