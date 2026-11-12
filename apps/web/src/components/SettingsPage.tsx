import type { ConfigOption } from '@somecode/protocol';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { t, getLanguagePreference, setLanguagePreference, type LanguagePreference, type MessageKey } from '../i18n/index.ts';
import type { AgentInfo, AgentUsage, ProjectInfo, ServerSettings } from '../lib/api.ts';
import { notificationsSupported, requestNotificationPermission } from '../lib/notify.ts';
import { updateClientSettings, useClientSettings } from '../lib/settings.ts';
import { playChime } from '../lib/sound.ts';
import { AgentList } from './AgentList.tsx';
import { CodeAppearanceSection } from './CodePreviewCard.tsx';
import { AutomationSettings, MemorySettings, type AutomationApi } from './AutomationSettings.tsx';
import { UsagePage } from './UsagePage.tsx';
import type { UsageHistory } from '../lib/usageStats.ts';
import { SettingsSelect } from './SettingsSelect.tsx';
import { SubagentModelPicker } from './SubagentModelPicker.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

type Category = 'general' | 'permissions' | 'appearance' | 'agents' | 'usage' | 'automation' | 'memory';
const CATEGORIES: { id: Category; icon: 'chat' | 'lock' | 'sun' | 'spark' | 'bolt' | 'brain' | 'ring' }[] = [
  { id: 'general', icon: 'chat' },
  { id: 'permissions', icon: 'lock' },
  { id: 'appearance', icon: 'sun' },
  { id: 'agents', icon: 'spark' },
  { id: 'usage', icon: 'ring' },
  { id: 'memory', icon: 'brain' },
  { id: 'automation', icon: 'bolt' },
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
  loadOptions,
  automation,
  usage,
  startCategory,
  onClose,
}: {
  light: boolean;
  onTheme: (light: boolean) => void;
  agents: AgentInfo[];
  onRefreshAgents: () => void;
  onSignIn: (agentId: string) => void;
  serverSettings: ServerSettings | null;
  onServerSetting: (patch: Partial<ServerSettings>) => Promise<void>;
  /** The model/effort options an agent really offers (asked without a prompt). */
  loadOptions?: (agentId: string) => Promise<ConfigOption[]>;
  /** Scheduled tasks and project memory (the Automation category appears when given). */
  automation?: { api: AutomationApi; projects: ProjectInfo[]; onOpenSession?: (sessionId: string) => void };
  /** The Usage category (limits and token history) appears when given. */
  usage?: { loadUsage: (refresh?: boolean) => Promise<AgentUsage[]>; loadHistory: (refresh?: boolean) => Promise<UsageHistory> };
  /** The category shown first (the Automation one only when `automation` is given). */
  startCategory?: Category;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<Category>(((startCategory === 'automation' || startCategory === 'memory') && !automation) || (startCategory === 'usage' && !usage) ? 'general' : (startCategory ?? 'general'));
  const [notifyDenied, setNotifyDenied] = useState(false);
  const loadAgentOptions = useCallback((agentId: string) => (loadOptions ? loadOptions(agentId) : Promise.resolve([] as ConfigOption[])), [loadOptions]);
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
          {CATEGORIES.filter((c) => (c.id !== 'automation' && c.id !== 'memory') || automation).filter((c) => c.id !== 'usage' || usage).map((c) => (
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
                  <SettingsSelect
                    label={t('settings.language')}
                    value={language}
                    options={[
                      { value: 'auto', label: t('settings.language.auto') },
                      { value: 'tr', label: 'Türkçe' },
                      { value: 'en', label: 'English' },
                    ]}
                    onChange={(next) => {
                      setLanguagePreference(next as LanguagePreference);
                      location.reload();
                    }}
                  />
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
                <SettingsSelect
                  label={t('settings.defaultApproval')}
                  value={serverSettings?.defaultApproval ?? 'ask'}
                  disabled={serverSettings === null}
                  options={[
                    { value: 'ask', label: t('approval.ask'), description: t('approval.ask.hint') },
                    { value: 'auto', label: t('approval.auto'), description: t('approval.auto.hint') },
                    { value: 'full', label: t('approval.full'), description: t('approval.full.hint') },
                  ]}
                  onChange={(next) => void onServerSetting({ defaultApproval: next })}
                />
              </Row>
            </Card>
            <Card title={t('settings.planSection')}>
              <Row
                title={t('settings.planAuto')}
                description={
                  <span>
                    {t('settings.planAutoHint')}
                    <span className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-text-muted">
                      <SymbolIcon name="lock" className="size-3 text-text-muted" />
                      {t('settings.lockedHint')}
                    </span>
                  </span>
                }
              >
                <Toggle
                  label={t('settings.planAuto')}
                  checked={serverSettings?.planAutoApprove ?? true}
                  disabled={serverSettings === null}
                  onChange={(v) => void onServerSetting({ planAutoApprove: v })}
                />
              </Row>
              <Row
                title={t('settings.agentGuide')}
                description={
                  <span>
                    {t('settings.agentGuideHint')}
                    <span className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-text-muted">
                      <SymbolIcon name="lock" className="size-3 text-text-muted" />
                      {t('settings.lockedHint')}
                    </span>
                  </span>
                }
              >
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
            <>
              <Card title={t('settings.codeAppearance')}>
                <div className="p-4.5 border-b border-border">
                  <CodeAppearanceSection
                    codeThemeLight={settings.codeThemeLight}
                    codeThemeDark={settings.codeThemeDark}
                    onLightChange={(id) => updateClientSettings({ codeThemeLight: id })}
                    onDarkChange={(id) => updateClientSettings({ codeThemeDark: id })}
                  />
                </div>
                <Row title={t('settings.codeFont')} description={t('settings.codeFontHint')}>
                  <input
                    type="text"
                    className="settings-input w-56 font-mono text-[12.5px]"
                    placeholder={t('settings.codeFontPlaceholder')}
                    value={settings.codeFontFamily}
                    onChange={(e) => updateClientSettings({ codeFontFamily: e.target.value })}
                  />
                </Row>
                <Row title={t('settings.codeFontSize')} description={t('settings.codeFontSizeHint')}>
                  <SettingsSelect
                    label={t('settings.codeFontSize')}
                    value={String(settings.codeFontSize)}
                    options={[11, 12, 13, 14, 15, 16, 18].map((size) => ({ value: String(size), label: size === 13 ? t('settings.codeFontSizeDefault', { size }) : t('settings.codeFontSizePx', { size }) }))}
                    onChange={(next) => updateClientSettings({ codeFontSize: Number(next) })}
                  />
                </Row>
              </Card>

              <Card title={t('settings.appearanceSection')}>
                <Row title={t('settings.theme')} description={t('settings.themeHint')}>
                  <SettingsSelect
                    label={t('settings.theme')}
                    value={light ? 'light' : 'dark'}
                    options={[
                      { value: 'dark', label: t('settings.theme.dark') },
                      { value: 'light', label: t('settings.theme.light') },
                    ]}
                    onChange={(next) => onTheme(next === 'light')}
                  />
                </Row>
                <Row title={t('settings.defaultTranscriptView')} description={t('settings.defaultTranscriptViewHint')}>
                  <div className="settings-segmented" role="radiogroup" aria-label={t('settings.defaultTranscriptView')}>
                    {(['normal', 'thinking', 'detailed'] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        role="radio"
                        aria-checked={settings.defaultTranscriptView === view}
                        onClick={() => updateClientSettings({ defaultTranscriptView: view })}
                        className="settings-segmented-btn"
                      >
                        {t(`settings.transcriptView.${view}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                </Row>
              </Card>
            </>
          )}
          {category === 'automation' && automation && (
            <AutomationSettings
              api={automation.api}
              projects={automation.projects}
              agents={agents}
              settings={serverSettings}
              onSetting={(patch) => void onServerSetting(patch)}
              {...(automation.onOpenSession ? { onOpenSession: automation.onOpenSession } : {})}
            />
          )}
          {category === 'usage' && usage && <UsagePage loadUsage={usage.loadUsage} loadHistory={usage.loadHistory} />}
          {category === 'memory' && automation && (
            <MemorySettings
              api={automation.api}
              projects={automation.projects}
              settings={serverSettings}
              onSetting={(patch) => void onServerSetting(patch)}
            />
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

              <div className="mb-2 mt-4 text-[13px] font-medium text-text-muted">Gemini Scout (Keşif Ajanı)</div>
              <Card>
                <Row title={t('settings.subagent.scoutStatus')} description={t('settings.subagent.scoutStatusHint')}>
                  <SettingsSelect
                    label={t('settings.subagent.scoutStatus')}
                    value={serverSettings?.scoutSubagent ? 'allow' : 'disallow'}
                    disabled={serverSettings === null}
                    options={[
                      { value: 'allow', label: t('settings.subagent.canLaunch') },
                      { value: 'disallow', label: t('settings.subagent.cannotLaunch') },
                    ]}
                    onChange={(next) => void onServerSetting({ scoutSubagent: next === 'allow' })}
                  />
                </Row>
                <Row title={t('settings.subagent.modelEffort')} description={t('settings.subagent.scoutModelHint')}>
                  <SubagentModelPicker
                    agentId="agy"
                    model={serverSettings?.scoutModel}
                    effort={serverSettings?.scoutEffort}
                    disabled={serverSettings === null || !loadOptions}
                    loadOptions={loadAgentOptions}
                    onChange={(patch) => void onServerSetting({ ...(patch.model !== undefined ? { scoutModel: patch.model } : {}), ...(patch.effort !== undefined ? { scoutEffort: patch.effort } : {}) })}
                  />
                </Row>
              </Card>

              <div className="mb-2 mt-4 text-[13px] font-medium text-text-muted">{t('settings.browser.section')}</div>
              <Card>
                <Row title={t('settings.browser.title')} description={t('settings.browser.hint')}>
                  <SettingsSelect
                    label={t('settings.browser.title')}
                    value={serverSettings?.browserTool ?? 'local'}
                    disabled={serverSettings === null}
                    options={[
                      { value: 'off', label: t('settings.browser.off') },
                      { value: 'local', label: t('settings.browser.local'), description: t('settings.browser.localHint') },
                      { value: 'any', label: t('settings.browser.any'), description: t('settings.browser.anyHint') },
                    ]}
                    onChange={(next) => void onServerSetting({ browserTool: next })}
                  />
                </Row>
              </Card>

              <div className="mb-2 mt-4 text-[13px] font-medium text-text-muted">Claude Subagent (Derin Akıl Yürütme)</div>
              <Card>
                <Row title={t('settings.subagent.claudeStatus')} description={t('settings.subagent.claudeStatusHint')}>
                  <SettingsSelect
                    label={t('settings.subagent.claudeStatus')}
                    value={serverSettings?.claudeSubagent ? 'allow' : 'disallow'}
                    disabled={serverSettings === null}
                    options={[
                      { value: 'allow', label: t('settings.subagent.canLaunch') },
                      { value: 'disallow', label: t('settings.subagent.cannotLaunch') },
                    ]}
                    onChange={(next) => void onServerSetting({ claudeSubagent: next === 'allow' })}
                  />
                </Row>
                <Row title={t('settings.subagent.modelEffort')} description={t('settings.subagent.claudeModelHint')}>
                  <SubagentModelPicker
                    agentId="claude"
                    model={serverSettings?.claudeModel}
                    effort={serverSettings?.claudeEffort}
                    disabled={serverSettings === null || !loadOptions}
                    loadOptions={loadAgentOptions}
                    onChange={(patch) => void onServerSetting({ ...(patch.model !== undefined ? { claudeModel: patch.model } : {}), ...(patch.effort !== undefined ? { claudeEffort: patch.effort } : {}) })}
                  />
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
