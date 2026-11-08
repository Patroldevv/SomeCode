import { useEffect, useId, useState, type ReactNode } from 'react';
import { t, getLanguagePreference, setLanguagePreference, type LanguagePreference, type MessageKey } from '../i18n/index.ts';
import type { AgentInfo, ServerSettings } from '../lib/api.ts';
import { notificationsSupported, requestNotificationPermission } from '../lib/notify.ts';
import { updateClientSettings, useClientSettings } from '../lib/settings.ts';
import { playChime } from '../lib/sound.ts';
import { AgentList } from './AgentList.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

type Category = 'general' | 'permissions' | 'appearance' | 'agents';
const CATEGORIES: { id: Category; icon: 'chat' | 'lock' | 'sun' | 'spark' }[] = [
  { id: 'general', icon: 'chat' },
  { id: 'permissions', icon: 'lock' },
  { id: 'appearance', icon: 'sun' },
  { id: 'agents', icon: 'spark' },
];

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-text">{title}</p>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="question-switch">
      <span className="question-switch-knob" />
    </button>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      {title && <h3 className="mb-2.5 text-[14px] font-medium text-text">{title}</h3>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

/**
 * The settings page: a few categories on the left, cards of rows on the right. Browser-side preferences are saved
 * at once; the server-side ones (`serverSettings`) are sent to the server, and the switch only flips once it agrees.
 */
export function SettingsPage({
  light,
  onTheme,
  agents,
  onRefreshAgents,
  onSignIn,
  serverSettings,
  onServerSetting,
  onClose,
}: {
  light: boolean;
  onTheme: (light: boolean) => void;
  agents: AgentInfo[];
  onRefreshAgents: () => void;
  onSignIn: (agentId: string) => void;
  serverSettings: ServerSettings | null;
  onServerSetting: (patch: Partial<ServerSettings>) => Promise<void>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<Category>('general');
  const [notifyDenied, setNotifyDenied] = useState(false);
  const settings = useClientSettings();
  const language = getLanguagePreference();
  const headingId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = t(`settings.cat.${category}` as MessageKey);
  return (
    <div className="settings-page" role="region" aria-labelledby={headingId}>
      <aside className="settings-nav">
        <div className="flex items-center gap-1 px-2 pb-3">
          <button type="button" className="icon-button" aria-label={t('settings.close')} title={t('settings.close')} onClick={onClose}>
            <SymbolIcon name="close" />
          </button>
          <h2 id={headingId} className="text-[17px] font-semibold tracking-tight">
            {t('settings.title')}
          </h2>
        </div>
        <ul role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
          {CATEGORIES.map((c) => (
            <li key={c.id}>
              <button type="button" role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)} className="nav-row settings-tab">
                <SymbolIcon name={c.icon} className="size-4" />
                <span>{t(`settings.cat.${c.id}` as MessageKey)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="settings-content">
        <div className="settings-body" role="tabpanel">
          <h1 className="mb-7 text-[26px] font-semibold tracking-tight">{title}</h1>
          {category === 'general' && (
            <>
              <Card>
                <Row title={t('settings.language')} description={t('settings.languageHint')}>
                  <select
                    className="settings-select"
                    aria-label={t('settings.language')}
                    value={language}
                    onChange={(e) => {
                      setLanguagePreference(e.target.value as LanguagePreference);
                      location.reload();
                    }}
                  >
                    <option value="auto">{t('settings.language.auto')}</option>
                    <option value="tr">Türkçe</option>
                    <option value="en">English</option>
                  </select>
                </Row>
                <Row title={t('settings.confirmClose')} description={t('settings.confirmCloseHint')}>
                  <Toggle label={t('settings.confirmClose')} checked={settings.confirmClose} onChange={(v) => updateClientSettings({ confirmClose: v })} />
                </Row>
                <Row title={t('settings.panelAtStart')} description={t('settings.panelAtStartHint')}>
                  <Toggle label={t('settings.panelAtStart')} checked={settings.openPanelAtStart} onChange={(v) => updateClientSettings({ openPanelAtStart: v })} />
                </Row>
                <Row title={t('settings.preventSleep')} description={t('settings.preventSleepHint')}>
                  <Toggle label={t('settings.preventSleep')} checked={settings.preventSleep} onChange={(v) => updateClientSettings({ preventSleep: v })} />
                </Row>
              </Card>
              <Card title={t('settings.notifications')}>
                <Row title={t('settings.sound')} description={t('settings.soundHint')}>
                  <span className="flex items-center gap-3">
                    <button type="button" className="question-skip" onClick={() => playChime('done')}>{t('settings.soundTry')}</button>
                    <Toggle label={t('settings.sound')} checked={settings.soundEnabled} onChange={(v) => updateClientSettings({ soundEnabled: v })} />
                  </span>
                </Row>
                <Row title={t('settings.notify')} description={notifyDenied ? t('settings.notifyDenied') : t('settings.notifyHint')}>
                  <Toggle
                    label={t('settings.notify')}
                    checked={settings.notifyEnabled}
                    disabled={!notificationsSupported()}
                    onChange={(v) => {
                      setNotifyDenied(false);
                      if (!v) return updateClientSettings({ notifyEnabled: false });
                      void requestNotificationPermission().then((ok) => {
                        setNotifyDenied(!ok);
                        updateClientSettings({ notifyEnabled: ok });
                      });
                    }}
                  />
                </Row>
                <Row title={t('settings.limitAlerts')} description={t('settings.limitAlertsHint')}>
                  <Toggle label={t('settings.limitAlerts')} checked={settings.limitAlerts} onChange={(v) => updateClientSettings({ limitAlerts: v })} />
                </Row>
              </Card>
            </>
          )}
          {category === 'permissions' && (
            <>
            <Card>
              <Row title={t('settings.defaultApproval')} description={t('settings.defaultApprovalHint')}>
                <select
                  className="settings-select"
                  aria-label={t('settings.defaultApproval')}
                  value={serverSettings?.defaultApproval ?? 'ask'}
                  disabled={serverSettings === null}
                  onChange={(e) => void onServerSetting({ defaultApproval: e.target.value as ServerSettings['defaultApproval'] })}
                >
                  <option value="ask">{t('approval.ask')}</option>
                  <option value="auto">{t('approval.auto')}</option>
                  <option value="full">{t('approval.full')}</option>
                </select>
              </Row>
            </Card>
            <Card title={t('settings.planSection')}>
              <Row title={t('settings.planAuto')} description={t('settings.planAutoHint')}>
                <Toggle
                  label={t('settings.planAuto')}
                  checked={serverSettings?.planAutoApprove ?? true}
                  disabled={serverSettings === null}
                  onChange={(v) => void onServerSetting({ planAutoApprove: v })}
                />
              </Row>
              <Row title={t('settings.agentGuide')} description={t('settings.agentGuideHint')}>
                <Toggle
                  label={t('settings.agentGuide')}
                  checked={serverSettings?.agentGuide ?? true}
                  disabled={serverSettings === null}
                  onChange={(v) => void onServerSetting({ agentGuide: v })}
                />
              </Row>
            </Card>
            </>
          )}
          {category === 'appearance' && (
            <Card>
              <Row title={t('settings.theme')} description={t('settings.themeHint')}>
                <select className="settings-select" aria-label={t('settings.theme')} value={light ? 'light' : 'dark'} onChange={(e) => onTheme(e.target.value === 'light')}>
                  <option value="dark">{t('settings.theme.dark')}</option>
                  <option value="light">{t('settings.theme.light')}</option>
                </select>
              </Row>
            </Card>
          )}
          {category === 'agents' && (
            <>
              <Card>
                <Row title={t('settings.subagentsEnabled')} description={t('settings.subagentsEnabledHint')}>
                  <Toggle label={t('settings.subagentsEnabled')} checked={settings.subagentsEnabled} onChange={(v) => updateClientSettings({ subagentsEnabled: v })} />
                </Row>
                <Row title={t('settings.autoContinue')} description={t('settings.autoContinueHint')}>
                  <Toggle label={t('settings.autoContinue')} checked={settings.autoContinueSubagents} onChange={(v) => updateClientSettings({ autoContinueSubagents: v })} />
                </Row>
                <Row title={t('settings.advanced')} description={t('settings.advancedHint')}>
                  <Toggle label={t('settings.advanced')} checked={settings.showAdvancedOptions} onChange={(v) => updateClientSettings({ showAdvancedOptions: v })} />
                </Row>
              </Card>
              <section className="mb-8">
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-[14px] font-medium text-text">{t('agent.list')}</h3>
                  <button type="button" className="icon-button" aria-label={t('agent.refresh')} onClick={onRefreshAgents}>
                    <SymbolIcon name="refresh" className="size-3.5" />
                  </button>
                </div>
                <div className="settings-card px-2 py-3">
                  <AgentList agents={agents} onSignIn={onSignIn} />
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
