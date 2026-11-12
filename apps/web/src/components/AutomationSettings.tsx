import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorText, t } from '../i18n/index.ts';
import { ApiError, type AgentInfo, type MemoryNote, type ProjectInfo, type ScheduledTaskInfo, type ServerSettings, type VerifyCheck, type VerifyConfig } from '../lib/api.ts';
import { EngineLogo } from './EngineLogos.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { SymbolIcon, type SymbolName } from './SymbolIcon.tsx';

export type AutomationApi = {
  tasks: () => Promise<ScheduledTaskInfo[]>;
  createTask: (input: { projectId: string; agentId: string; title: string; prompt: string; spec: { kind: 'once'; at: string } | { kind: 'every'; minutes: number } | { kind: 'daily'; at: string } }) => Promise<ScheduledTaskInfo>;
  updateTask: (id: string, patch: { enabled?: boolean }) => Promise<unknown>;
  deleteTask: (id: string) => Promise<unknown>;
  runTask: (id: string) => Promise<{ sessionId: string }>;
  memory: (projectId: string) => Promise<MemoryNote[]>;
  addMemory: (projectId: string, text: string) => Promise<MemoryNote>;
  deleteMemory: (id: string) => Promise<unknown>;
  importMemory: (projectId: string, text: string) => Promise<{ added: number; skipped: number }>;
  exportMemory: () => Promise<void>;
  verifyConfig: (projectId: string) => Promise<{ config: VerifyConfig; suggested: VerifyCheck[] }>;
  saveVerifyConfig: (projectId: string, config: VerifyConfig) => Promise<VerifyConfig>;
  askForChecks: (projectId: string, agentId: string, prompt: string) => Promise<{ sessionId: string }>;
};

type Engine = NonNullable<ServerSettings['researchEngines']>[number];
const ENGINES: { id: Engine; name: string }[] = [
  { id: 'google', name: 'Google' },
  { id: 'yandex', name: 'Yandex' },
  { id: 'bing', name: 'Bing' },
  { id: 'duckduckgo', name: 'DuckDuckGo' },
  { id: 'brave', name: 'Brave' },
];
const DEFAULT_ENGINES: Engine[] = ['google', 'yandex', 'bing', 'duckduckgo'];

const EVERY = [15, 30, 60, 120, 360, 720, 1440];

const when = (ms: number | null): string =>
  ms === null ? '' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className="question-switch">
      <span className="question-switch-knob" />
    </button>
  );
}

/** One setting: an icon tile, a title with its explanation, and the control (a switch unless given). */
function Setting({ icon, title, hint, children, disabled = false }: { icon: SymbolName; title: string; hint?: string; children: ReactNode; disabled?: boolean }) {
  return (
    <div className="settings-row auto-row" data-disabled={disabled || undefined}>
      <span className="auto-icon" aria-hidden="true">
        <SymbolIcon name={icon} className="size-[17px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-text">{title}</p>
        {hint && <p className="mt-0.5 text-[13px] leading-snug text-text-muted">{hint}</p>}
      </div>
      <div className="auto-control">{children}</div>
    </div>
  );
}

/** The commands that check a project after the agent changed files, set per project and saved with the button. */
function ChecksSettings({ api, projects, agents, settings, onSetting, onOpenSession }: { api: AutomationApi; projects: ProjectInfo[]; agents: AgentInfo[]; settings: ServerSettings | null; onSetting: (patch: Partial<ServerSettings>) => void; onOpenSession?: (sessionId: string) => void }) {
  const installed = agents.filter((a) => a.installed);
  const [agentId, setAgentId] = useState(installed[0]?.id ?? '');
  const [asking, setAsking] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [saved, setSaved] = useState<VerifyConfig | null>(null);
  const [draft, setDraft] = useState<VerifyConfig | null>(null);
  const [suggested, setSuggested] = useState<VerifyCheck[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setDraft(null);
    setNotice(null);
    void api
      .verifyConfig(projectId)
      .then(({ config, suggested: list }) => {
        if (!alive) return;
        setSaved(config);
        setDraft(config);
        setSuggested(list);
      })
      .catch(() => alive && setDraft(null));
    return () => {
      alive = false;
    };
  }, [api, projectId]);
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const valid = draft !== null && draft.checks.every((c) => c.name.trim() !== '' && c.command.trim() !== '');
  const set = (patch: Partial<VerifyConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const edit = (i: number, patch: Partial<VerifyCheck>) => setDraft((d) => (d ? { ...d, checks: d.checks.map((c, n) => (n === i ? { ...c, ...patch } : c)) } : d));
  const save = async () => {
    if (!draft || !valid) return;
    try {
      const next = await api.saveVerifyConfig(projectId, { ...draft, checks: draft.checks.map((c) => ({ name: c.name.trim(), command: c.command.trim() })) });
      setSaved(next);
      setDraft(next);
      setNotice(t('checks.saved'));
    } catch (err) {
      setNotice(errorText(err instanceof ApiError ? err.code : 'internal'));
    }
  };
  return (
    <section className="mb-8" aria-label={t('checks.title')}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-medium text-text">{t('checks.title')}</h3>
        {projects.length > 0 && <SettingsSelect label={t('checks.project')} value={projectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setProjectId} />}
      </div>
      <p className="mb-3 text-[13px] leading-snug text-text-muted">{t('checks.hint')}</p>
      <div className="settings-card">
        <Setting icon="spark" title={t('checks.autoPropose')} hint={t('checks.autoProposeHint')} disabled={settings?.agentTools === false}>
          <Switch label={t('checks.autoPropose')} checked={settings?.agentTools !== false && (settings?.autoChecks ?? true)} onChange={(v) => onSetting({ autoChecks: v })} />
        </Setting>
        {draft && (
          <>
            <Setting icon="shield" title={t('checks.enabled')} hint={t('checks.enabledHint')}>
              <Switch label={t('checks.enabled')} checked={draft.enabled} onChange={(v) => set({ enabled: v })} />
            </Setting>
            <Setting icon="refresh" title={t('checks.autoFix')} hint={t('checks.autoFixHint')} disabled={!draft.enabled}>
              <Switch label={t('checks.autoFix')} checked={draft.autoFix} onChange={(v) => set({ autoFix: v })} />
            </Setting>
            <Setting icon="steps" title={t('checks.maxFixes')} disabled={!draft.enabled || !draft.autoFix}>
              <SettingsSelect
                label={t('checks.maxFixes')}
                value={String(draft.maxFixes)}
                options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: n === 0 ? t('checks.round0') : n === 1 ? t('checks.round1') : t('checks.rounds', { count: n }) }))}
                onChange={(v) => set({ maxFixes: Number(v) })}
              />
            </Setting>
            <div className="plugin-form">
              {draft.checks.length === 0 && <p className="text-[13px] text-text-muted">{t('checks.empty')}</p>}
              {draft.checks.map((check, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="question-input !w-32 shrink-0" aria-label={t('checks.name')} placeholder={t('checks.name')} value={check.name} maxLength={40} onChange={(e) => edit(i, { name: e.target.value })} />
                  <input className="question-input min-w-0 flex-1 font-mono" aria-label={t('checks.command')} placeholder={t('checks.command')} value={check.command} maxLength={400} onChange={(e) => edit(i, { command: e.target.value })} />
                  <button type="button" className="icon-button" aria-label={t('checks.remove', { name: check.name || String(i + 1) })} onClick={() => set({ checks: draft.checks.filter((_, n) => n !== i) })}>
                    <SymbolIcon name="close" className="size-4" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="question-skip" disabled={draft.checks.length >= 8} onClick={() => set({ checks: [...draft.checks, { name: '', command: '' }] })}>
                  {t('checks.add')}
                </button>
                <span className="flex-1" />
              </div>
              <div className="checks-suggest">
                <p className="checks-suggest-label">{t('checks.suggested')}</p>
                {suggested.length === 0 ? (
                  <p className="text-[12.5px] text-text-muted">{t('checks.suggestNone')}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {suggested.map((s) => {
                      const on = draft.checks.some((c) => c.command === s.command);
                      return (
                        <button key={s.command} type="button" className="engine-pill" aria-pressed={on} disabled={on || draft.checks.length >= 8} title={s.command} onClick={() => set({ checks: [...draft.checks, s] })}>
                          {on ? <SymbolIcon name="check" className="size-3" /> : <SymbolIcon name="plus" className="size-3" />}
                          {s.name}
                          <code className="checks-chip-command">{s.command}</code>
                        </button>
                      );
                    })}
                    <button type="button" className="question-skip" disabled={suggested.every((s) => draft.checks.some((c) => c.command === s.command))} onClick={() => set({ checks: [...draft.checks, ...suggested.filter((s) => !draft.checks.some((c) => c.command === s.command))].slice(0, 8) })}>
                      {t('checks.suggest')}
                    </button>
                  </div>
                )}
              </div>
              <div className="checks-agent">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-text">{t('checks.askTitle')}</p>
                  <p className="text-[12.5px] leading-snug text-text-muted">{t('checks.askHint')}</p>
                </div>
                {installed.length > 1 && <SettingsSelect label={t('tasks.agent')} value={agentId} options={installed.map((a) => ({ value: a.id, label: a.label }))} onChange={setAgentId} />}
                <button
                  type="button"
                  className="question-submit"
                  disabled={asking || !agentId || !projectId}
                  onClick={() => {
                    setAsking(true);
                    setNotice(null);
                    void api
                      .askForChecks(projectId, agentId, t('checks.askPrompt'))
                      .then(({ sessionId }) => onOpenSession?.(sessionId))
                      .catch((err: unknown) => setNotice(errorText(err instanceof ApiError ? err.code : 'internal')))
                      .finally(() => setAsking(false));
                  }}
                >
                  {asking ? t('checks.asking') : t('checks.ask')}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1" />
                {notice && <span role="status" className="text-sm text-text-muted">{notice}</span>}
                <button type="button" className="question-submit" disabled={!dirty || !valid} onClick={() => void save()}>
                  {t('checks.save')}
                </button>
              </div>
            </div>
          </>
        )}
        {projects.length === 0 && <p className="px-4 py-4 text-sm text-text-muted">{t('memory.noProject')}</p>}
      </div>
    </section>
  );
}

function NewTask({ api, projects, agents, onCreated }: { api: AutomationApi; projects: ProjectInfo[]; agents: AgentInfo[]; onCreated: () => void }) {
  const installed = agents.filter((a) => a.installed);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [agentId, setAgentId] = useState(installed[0]?.id ?? '');
  const [kind, setKind] = useState<'once' | 'every' | 'daily'>('daily');
  const [at, setAt] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = title.trim() !== '' && prompt.trim().length >= 3 && projectId !== '' && agentId !== '' && (kind !== 'once' || at !== '') && (kind !== 'daily' || time !== '');
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createTask({
        projectId,
        agentId,
        title: title.trim(),
        prompt: prompt.trim(),
        spec: kind === 'once' ? { kind, at } : kind === 'every' ? { kind, minutes: Number(minutes) } : { kind, at: time },
      });
      setTitle('');
      setPrompt('');
      onCreated();
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="plugin-form"
      aria-label={t('tasks.new')}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <input className="question-input" aria-label={t('tasks.name')} placeholder={t('tasks.name')} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="question-input" rows={3} aria-label={t('tasks.prompt')} placeholder={t('tasks.prompt')} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <SettingsSelect align="left" label={t('tasks.project')} value={projectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setProjectId} />
        <SettingsSelect align="left" label={t('tasks.agent')} value={agentId} options={installed.map((a) => ({ value: a.id, label: a.label }))} onChange={setAgentId} />
        <SettingsSelect
          align="left"
          label={t('tasks.kind')}
          value={kind}
          options={[
            { value: 'daily', label: t('tasks.kind.daily') },
            { value: 'every', label: t('tasks.kind.every') },
            { value: 'once', label: t('tasks.kind.once') },
          ]}
          onChange={setKind}
        />
        {kind === 'once' && <input type="datetime-local" className="question-input !w-auto" aria-label={t('tasks.at')} value={at} onChange={(e) => setAt(e.target.value)} />}
        {kind === 'daily' && <input type="time" className="question-input !w-auto" aria-label={t('tasks.time')} value={time} onChange={(e) => setTime(e.target.value)} />}
        {kind === 'every' && (
          <SettingsSelect
            align="left"
            label={t('tasks.interval')}
            value={minutes}
            options={EVERY.map((m) => ({ value: String(m), label: m % 60 === 0 ? t('tasks.everyHours', { count: m / 60 }) : t('tasks.everyMinutes', { count: m }) }))}
            onChange={setMinutes}
          />
        )}
      </div>
      <p className="text-[12.5px] leading-snug text-text-muted">{t('tasks.note')}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="question-submit" disabled={!ready || busy}>{t('tasks.create')}</button>
      </div>
    </form>
  );
}

/** Scheduled tasks and project memory: what agents (or you) set up so that work happens later and notes outlive a chat. */
export function AutomationSettings({
  api,
  projects,
  agents,
  settings,
  onSetting,
  onOpenSession,
}: {
  api: AutomationApi;
  projects: ProjectInfo[];
  agents: AgentInfo[];
  settings: ServerSettings | null;
  onSetting: (patch: Partial<ServerSettings>) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const on = (value: boolean | undefined) => value ?? true;
  const toolsOn = on(settings?.agentTools);
  const engines = settings?.researchEngines ?? DEFAULT_ENGINES;
  const [tasks, setTasks] = useState<ScheduledTaskInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTasks = useCallback(() => void api.tasks().then(setTasks).catch(() => setTasks([])), [api]);
  useEffect(() => loadTasks(), [loadTasks]);
  const act = async (work: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setNotice(errorText(err instanceof ApiError ? err.code : 'internal'));
    }
    loadTasks();
  };

  return (
    <>
      <section className="mb-8" aria-label={t('automation.toolsGroup')}>
        <h3 className="mb-2.5 text-[14px] font-medium text-text">{t('automation.toolsGroup')}</h3>
        <div className="settings-card">
          <Setting icon="bolt" title={t('automation.tools')} hint={t('automation.toolsHint')}>
            <Switch label={t('automation.tools')} checked={toolsOn} onChange={(v) => onSetting({ agentTools: v })} />
          </Setting>
          <Setting icon="schedule" title={t('automation.schedule')} hint={t('automation.scheduleHint')} disabled={!toolsOn}>
            <Switch label={t('automation.schedule')} checked={toolsOn && on(settings?.scheduledTasks)} onChange={(v) => onSetting({ scheduledTasks: v })} />
          </Setting>
        </div>
        <p className="mt-2 text-[12.5px] text-text-muted">{t('automation.newChatsNote')}</p>
      </section>

      <section className="mb-8" aria-label={t('research.title')}>
        <h3 className="mb-2.5 text-[14px] font-medium text-text">{t('research.title')}</h3>
        <div className="settings-card">
          <Setting icon="steps" title={t('research.plan')} hint={t('research.planHint')} disabled={!toolsOn}>
            <Switch label={t('research.plan')} checked={on(settings?.researchPlan)} onChange={(v) => onSetting({ researchPlan: v })} />
          </Setting>
          <Setting icon="research" title={t('research.depth')} hint={t('research.depthHint')} disabled={!toolsOn}>
            <SettingsSelect
              label={t('research.depth')}
              value={settings?.researchDepth ?? 'deep'}
              options={[
                { value: 'standard', label: t('research.depth.standard'), description: t('research.depth.standardHint') },
                { value: 'deep', label: t('research.depth.deep'), description: t('research.depth.deepHint') },
                { value: 'exhaustive', label: t('research.depth.exhaustive'), description: t('research.depth.exhaustiveHint') },
              ]}
              onChange={(v) => onSetting({ researchDepth: v as NonNullable<ServerSettings['researchDepth']> })}
            />
          </Setting>
          <Setting icon="globe" title={t('research.engines')} hint={t('research.enginesHint')} disabled={!toolsOn}>
            <div className="engine-pills" role="group" aria-label={t('research.engines')}>
              {ENGINES.map((e) => {
                const active = engines.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    className="engine-pill"
                    aria-pressed={active}
                    // At least one engine stays on: a research with none could not search.
                    disabled={active && engines.length === 1}
                    onClick={() => onSetting({ researchEngines: active ? engines.filter((x) => x !== e.id) : ENGINES.map((x) => x.id).filter((x) => x === e.id || engines.includes(x)) })}
                  >
                    <EngineLogo id={e.id} className="size-3.5" />
                    {e.name}
                  </button>
                );
              })}
            </div>
          </Setting>
        </div>
      </section>

      <ChecksSettings api={api} projects={projects} agents={agents} settings={settings} onSetting={onSetting} {...(onOpenSession ? { onOpenSession } : {})} />

      <section className="mb-8" aria-label={t('tasks.title')}>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h3 className="text-[14px] font-medium text-text">{t('tasks.title')}</h3>
          <button type="button" className="plugins-add-button" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            {t('tasks.new')}
          </button>
        </div>
        <p className="mb-3 text-[13px] leading-snug text-text-muted">{t('tasks.hint')}</p>
        <div className="settings-card">
          {adding && <NewTask api={api} projects={projects} agents={agents} onCreated={() => { setAdding(false); loadTasks(); }} />}
          {tasks?.length === 0 && !adding && <p className="px-4 py-4 text-sm text-text-muted">{t('tasks.empty')}</p>}
          {tasks?.map((task) => (
            <div key={task.id} className="settings-row">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-text">{task.title}</p>
                <p className="truncate text-[13px] text-text-muted">
                  {task.project} · {task.when} · {task.enabled && task.nextRun ? t('tasks.next', { when: when(task.nextRun) }) : t('tasks.paused')}
                  {task.runs > 0 ? ` · ${t('tasks.ran', { count: task.runs })}` : ''}
                </p>
              </div>
              {task.lastSessionId && onOpenSession && (
                <button type="button" className="icon-button" aria-label={t('tasks.openLast', { name: task.title })} title={t('tasks.openLast', { name: task.title })} onClick={() => onOpenSession(task.lastSessionId!)}>
                  <SymbolIcon name="chat" className="size-4" />
                </button>
              )}
              <button type="button" className="question-skip" aria-label={t('tasks.runNow', { name: task.title })} onClick={() => void act(async () => { const { sessionId } = await api.runTask(task.id); setNotice(t('tasks.started')); onOpenSession?.(sessionId); })}>
                {t('tasks.run')}
              </button>
              <Switch label={t('tasks.enabled', { name: task.title })} checked={task.enabled} onChange={(on) => void act(() => api.updateTask(task.id, { enabled: on }))} />
              <button type="button" className="icon-button" aria-label={t('tasks.delete', { name: task.title })} title={t('tasks.delete', { name: task.title })} onClick={() => void act(() => api.deleteTask(task.id))}>
                <SymbolIcon name="close" className="size-4" />
              </button>
            </div>
          ))}
        </div>
        {notice && <p role="status" className="mt-2 text-sm text-text-muted">{notice}</p>}
      </section>

    </>
  );
}

/** What agents remember: past chats they may search and notes about each project (kept, imported, exported). */
export function MemorySettings({
  api,
  projects,
  settings,
  onSetting,
}: {
  api: AutomationApi;
  projects: ProjectInfo[];
  settings: ServerSettings | null;
  onSetting: (patch: Partial<ServerSettings>) => void;
}) {
  const on = (value: boolean | undefined) => value ?? true;
  const toolsOn = on(settings?.agentTools);
  const memoryOn = toolsOn && on(settings?.projectMemory);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [notes, setNotes] = useState<MemoryNote[] | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!projectId) return setNotes([]);
    let alive = true;
    setNotes(null);
    void api.memory(projectId).then((n) => alive && setNotes(n)).catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
  }, [api, projectId]);

  return (
    <>
      <section className="mb-8" aria-label={t('memory.group')}>
        <div className="settings-card">
          <Setting icon="history" title={t('automation.history')} hint={t('automation.historyHint')} disabled={!toolsOn}>
            <Switch label={t('automation.history')} checked={toolsOn && on(settings?.historySearch)} onChange={(v) => onSetting({ historySearch: v })} />
          </Setting>
          <Setting icon="brain" title={t('automation.memory')} hint={t('automation.memoryHint')} disabled={!toolsOn}>
            <Switch label={t('automation.memory')} checked={memoryOn} onChange={(v) => onSetting({ projectMemory: v })} />
          </Setting>
          <Setting icon="spark" title={t('automation.autoMemory')} hint={t('automation.autoMemoryHint')} disabled={!memoryOn}>
            <Switch label={t('automation.autoMemory')} checked={memoryOn && on(settings?.autoMemory)} onChange={(v) => onSetting({ autoMemory: v })} />
          </Setting>
        </div>
        <p className="mt-2 text-[12.5px] text-text-muted">{toolsOn ? t('automation.newChatsNote') : t('memory.toolsOff')}</p>
      </section>

      <section className="mb-8" aria-label={t('memory.title')}>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h3 className="text-[14px] font-medium text-text">{t('memory.title')}</h3>
          <div className="flex items-center gap-2">
            {projects.length > 0 && <SettingsSelect label={t('memory.project')} value={projectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setProjectId} />}
            {projects.length > 0 && (
              <button type="button" className="plan-btn" aria-expanded={importing} onClick={() => setImporting((v) => !v)}>
                <SymbolIcon name="upload" className="size-3.5" /> {t('memory.import')}
              </button>
            )}
            <button type="button" className="plan-btn" title={t('memory.exportHint')} onClick={() => void api.exportMemory().catch((err: unknown) => setMemoryNotice(errorText(err instanceof ApiError ? err.code : 'internal')))}>
              <SymbolIcon name="download" className="size-3.5" /> {t('memory.export')}
            </button>
          </div>
        </div>
        <p className="mb-3 text-[13px] leading-snug text-text-muted">{t('memory.hint')}</p>
        <div className="settings-card">
          {importing && projects.length > 0 && (
            <div className="plugin-form" role="group" aria-label={t('memory.importTitle')}>
              <p className="text-[13px] leading-snug text-text-muted">{t('memory.importHint')}</p>
              <textarea className="question-input" rows={5} aria-label={t('memory.importTitle')} value={importText} onChange={(e) => setImportText(e.target.value)} />
              <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                className="sr-only"
                aria-label={t('memory.importFile')}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void file.text().then((text) => setImportText((old) => (old ? `${old}\n${text}` : text)));
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <button type="button" className="question-skip" onClick={() => fileInput.current?.click()}>{t('memory.importFile')}</button>
                <button
                  type="button"
                  className="question-submit"
                  disabled={importText.trim().length < 3}
                  onClick={() =>
                    void api
                      .importMemory(projectId, importText)
                      .then(({ added, skipped }) => {
                        setMemoryNotice(t('memory.imported', { added, skipped }));
                        setImportText('');
                        setImporting(false);
                        return api.memory(projectId).then(setNotes);
                      })
                      .catch((err: unknown) => setMemoryNotice(errorText(err instanceof ApiError ? err.code : 'internal')))
                  }
                >
                  {t('memory.importDo')}
                </button>
              </div>
            </div>
          )}
          {projects.length === 0 && <p className="px-4 py-4 text-sm text-text-muted">{t('memory.noProject')}</p>}
          {projects.length > 0 && notes?.length === 0 && <p className="px-4 py-4 text-sm text-text-muted">{t('memory.empty')}</p>}
          {notes?.map((n) => (
            <div key={n.id} className="settings-row">
              <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-text [overflow-wrap:anywhere]">{n.text}</p>
              <button type="button" className="icon-button" aria-label={t('memory.forget', { note: n.text.slice(0, 30) })} title={t('memory.forgetShort')} onClick={() => void api.deleteMemory(n.id).then(() => setNotes((all) => all?.filter((x) => x.id !== n.id) ?? null))}>
                <SymbolIcon name="close" className="size-4" />
              </button>
            </div>
          ))}
          {projects.length > 0 && (
            <form
              className="settings-row"
              onSubmit={(e) => {
                e.preventDefault();
                const text = note.trim();
                if (text.length < 3) return;
                void api.addMemory(projectId, text).then((m) => {
                  setNote('');
                  setNotes((all) => (all?.some((x) => x.id === m.id) ? all : [...(all ?? []), m]));
                });
              }}
            >
              <input className="question-input flex-1" aria-label={t('memory.add')} placeholder={t('memory.add')} value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} />
              <button type="submit" className="question-submit" disabled={note.trim().length < 3}>{t('memory.addButton')}</button>
            </form>
          )}
        </div>
        {memoryNotice && <p role="status" className="mt-2 text-sm text-text-muted">{memoryNotice}</p>}
      </section>
    </>
  );
}
