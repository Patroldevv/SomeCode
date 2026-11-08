import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorText, t } from '../i18n/index.ts';
import { ApiError, type PluginInfo, type PluginsOverview, type ServiceInfo, type SkillInfo } from '../lib/api.ts';
import { safeHref } from '../lib/safeUrl.ts';
import { CheckIcon } from './icons.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

type Api = {
  plugins: () => Promise<PluginsOverview>;
  services: () => Promise<ServiceInfo[]>;
  connectService: (input: { name: string; url: string; transport: string; token?: string }) => Promise<unknown>;
  disconnectService: (name: string) => Promise<unknown>;
  pluginIcon: (owner: string) => Promise<string | null>;
  pluginAction: (action: 'install' | 'uninstall' | 'enable' | 'disable', id: string) => Promise<unknown>;
  addSkill: (input: { agent: string; name: string; description: string; content: string }) => Promise<unknown>;
  addSkillsFromGit: (agent: string, url: string) => Promise<{ added: string[] }>;
  removeSkill: (agent: string, name: string) => Promise<unknown>;
  /** The lists from the last time they were asked for, so the page opens on them at once. */
  cachedPlugins?: () => { overview: PluginsOverview; services: ServiceInfo[] } | null;
};

const AGENTS = [
  { id: 'claude', label: 'Claude' },
  { id: 'agy', label: 'Antigravity' },
] as const;

/** "redis-development" -> "Redis development". */
export const prettyName = (name: string): string => {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Per-category rows shown before "show more". */
const PER_CATEGORY = 8;
const SEARCH_LIMIT = 60;

function Tile({ name, size = 40 }: { name: string; size?: number }) {
  // A steady colour per name, from a small neutral-ish palette that works on both themes.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="plugin-tile" style={{ ['--tile-hue' as string]: hash, width: size, height: size }} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The logo: a GitHub avatar, loaded once the card is on screen; the letter tile until it is there or when there is none. */
function Logo({ owner, name, load, size = 40 }: { owner: string | undefined; name: string; load: (owner: string) => Promise<string | null>; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const fetchIt = () => void load(owner).then((url) => alive && setSrc(url)).catch(() => {});
    if (typeof IntersectionObserver === 'undefined' || !ref.current) {
      fetchIt();
      return () => {
        alive = false;
      };
    }
    // Start a screen early, so a logo is usually there before its card scrolls into view.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          fetchIt();
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [owner, load]);
  return (
    <span ref={ref} className="plugin-logo" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" width={size} height={size} /> : <Tile name={name} size={size} />}
    </span>
  );
}

function Switch({ label, checked, busy, onChange }: { label: string; checked: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={busy} onClick={() => onChange(!checked)} className="question-switch">
      <span className="question-switch-knob" />
    </button>
  );
}

function Card({ plugin, busy, onInstall, onOpen, load }: { plugin: PluginInfo; busy: boolean; onInstall: () => void; onOpen: () => void; load: (owner: string) => Promise<string | null> }) {
  return (
    <li className="plugin-card">
      <button type="button" className="plugin-card-main" onClick={onOpen} aria-label={t('plugins.details', { name: prettyName(plugin.name) })}>
        <Logo owner={plugin.owner} name={plugin.name} load={load} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14.5px] font-medium text-text" title={plugin.id}>{prettyName(plugin.name)}</span>
          <span className="block truncate text-[13px] text-text-muted" title={plugin.description}>{plugin.description || plugin.marketplace}</span>
        </span>
      </button>
      {plugin.installed ? (
        <span className="plugin-added" role="img" aria-label={t('plugins.installed')}>
          <CheckIcon className="animate-pop size-[18px]" />
        </span>
      ) : (
        <button type="button" className="plugin-add" aria-label={t('plugins.install', { name: prettyName(plugin.name) })} title={t('plugins.install', { name: prettyName(plugin.name) })} disabled={busy} onClick={onInstall}>
          {busy ? <span className="loading-ring size-3.5 border-[1.5px]" role="status" aria-label={t('plugins.installing')} /> : <SymbolIcon name="plus" className="size-[18px]" />}
        </button>
      )}
    </li>
  );
}

function AddSkill({ api, onDone, onCancel }: { api: Api; onDone: (message: string) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'write' | 'git'>('write');
  const [agent, setAgent] = useState<string>('claude');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = mode === 'write' ? name.trim() !== '' && description.trim() !== '' && content.trim() !== '' : url.trim() !== '';
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'write') {
        await api.addSkill({ agent, name: name.trim(), description: description.trim(), content });
        onDone(t('plugins.skillAdded', { names: name.trim() }));
      } else {
        const { added } = await api.addSkillsFromGit(agent, url.trim());
        onDone(t('plugins.skillAdded', { names: added.join(', ') }));
      }
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'internal'));
      setBusy(false);
    }
  };
  return (
    <form
      className="plugin-form"
      aria-label={t('plugins.addSkill')}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="panel-tabs !m-0" role="tablist">
          {(['write', 'git'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
              {t(m === 'write' ? 'plugins.write' : 'plugins.fromGit')}
            </button>
          ))}
        </div>
        <select className="settings-select" aria-label={t('plugins.forAgent')} value={agent} onChange={(e) => setAgent(e.target.value)}>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>
      {mode === 'write' ? (
        <>
          <input className="question-input" aria-label={t('plugins.skillName')} placeholder={t('plugins.skillName')} value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} />
          <input className="question-input" aria-label={t('plugins.skillDescription')} placeholder={t('plugins.skillDescription')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <textarea className="question-input" rows={6} aria-label={t('plugins.skillInstructions')} placeholder={t('plugins.skillInstructions')} value={content} onChange={(e) => setContent(e.target.value)} />
        </>
      ) : (
        <input className="question-input" aria-label={t('plugins.gitUrl')} placeholder="https://github.com/owner/repo" value={url} onChange={(e) => setUrl(e.target.value)} />
      )}
      <p className="text-[12.5px] leading-snug text-text-muted">{t('plugins.trust')}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="question-submit" disabled={!ready || busy}>{busy ? t('plugins.adding') : t('plugins.add')}</button>
        <button type="button" className="question-skip" onClick={onCancel}>{t('menu.cancel')}</button>
      </div>
    </form>
  );
}

/** What a plugin adds, as short phrases ("2 skills", "1 command", ...). */
function contents(c: NonNullable<PluginInfo['components']>): string[] {
  return [
    c.skills > 0 ? t('plugins.has.skills', { count: c.skills }) : '',
    c.commands > 0 ? t('plugins.has.commands', { count: c.commands }) : '',
    c.agents > 0 ? t('plugins.has.agents', { count: c.agents }) : '',
    c.hooks ? t('plugins.has.hooks') : '',
    c.mcp ? t('plugins.has.mcp') : '',
  ].filter(Boolean);
}

function Detail({ plugin, busy, load, onInstall, onUninstall, onClose }: { plugin: PluginInfo; busy: boolean; load: (owner: string) => Promise<string | null>; onInstall: () => void; onUninstall: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const home = plugin.homepage ? safeHref(plugin.homepage) : null;
  const parts = plugin.components ? contents(plugin.components) : [];
  return (
    <div className="plugin-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={prettyName(plugin.name)} className="plugin-detail">
        <div className="flex items-start gap-4">
          <Logo owner={plugin.owner} name={plugin.name} load={load} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[20px] font-semibold tracking-tight">{prettyName(plugin.name)}</h2>
            <p className="text-[13px] text-text-muted">
              {[plugin.author, plugin.category && prettyName(plugin.category), plugin.version].filter(Boolean).join(' · ') || plugin.marketplace}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label={t('settings.close')} onClick={onClose}>
            <SymbolIcon name="close" />
          </button>
        </div>
        <p className="mt-4 text-[14px] leading-relaxed text-text">{plugin.description || t('plugins.noDescription')}</p>
        {parts.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-text-muted">
            {t('plugins.adds')}
            {parts.map((p) => (
              <span key={p} className="plugin-chip">{p}</span>
            ))}
          </p>
        )}
        <p className="mt-4 text-[12.5px] leading-snug text-text-muted">{t('plugins.trust')}</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {plugin.installed ? (
            <button type="button" className="question-skip" disabled={busy} onClick={onUninstall}>{t('plugins.uninstallShort')}</button>
          ) : (
            <button type="button" className="question-submit" disabled={busy} onClick={onInstall}>{busy ? t('plugins.installing') : t('plugins.installShort')}</button>
          )}
          {home && (
            <a className="text-[13px] text-text-muted underline underline-offset-4 hover:text-text" href={home} target="_blank" rel="noopener noreferrer">
              {t('plugins.homepage')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ServiceCard({ service, busy, load, onSetup, onDisconnect }: { service: ServiceInfo; busy: boolean; load: (owner: string) => Promise<string | null>; onSetup: () => void; onDisconnect: () => void }) {
  return (
    <li className="plugin-card">
      <div className="plugin-card-main !cursor-default">
        <Logo owner={service.owner} name={service.name} load={load} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14.5px] font-medium text-text">{service.name}</span>
          <span className="block truncate text-[13px] text-text-muted" title={service.description}>{service.description}</span>
        </span>
      </div>
      {service.connected ? (
        <button type="button" className="plugin-chip-button inline-flex items-center gap-1" disabled={busy} aria-label={t('services.disconnect', { name: service.name })} onClick={onDisconnect}>
          <CheckIcon className="size-3.5" />
          {t('services.connected')}
        </button>
      ) : (
        <button type="button" className="plugin-add" disabled={busy} aria-label={t('services.connect', { name: service.name })} title={t('services.connect', { name: service.name })} onClick={onSetup}>
          {busy ? <span className="loading-ring size-3.5 border-[1.5px]" role="status" aria-label={t('services.connecting')} /> : <SymbolIcon name="plus" className="size-[18px]" />}
        </button>
      )}
    </li>
  );
}

function ConnectForm({ onConnect, onCancel, busy }: { onConnect: (input: { name: string; url: string; transport: string; token?: string }) => void; onCancel: () => void; busy: boolean }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState('http');
  const [token, setToken] = useState('');
  const ready = name.trim() !== '' && url.trim() !== '';
  return (
    <form
      className="plugin-form"
      aria-label={t('services.custom')}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onConnect({ name: name.trim(), url: url.trim(), transport, ...(token.trim() ? { token: token.trim() } : {}) });
      }}
    >
      <input className="question-input" aria-label={t('services.name')} placeholder={t('services.name')} value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} />
      <input className="question-input" aria-label={t('services.url')} placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
      <select className="settings-select self-start" aria-label={t('services.transport')} value={transport} onChange={(e) => setTransport(e.target.value)}>
        <option value="http">HTTP</option>
        <option value="sse">SSE</option>
      </select>
      <input className="question-input" type="password" autoComplete="off" aria-label={t('services.token')} placeholder={t('services.token')} value={token} onChange={(e) => setToken(e.target.value)} />
      <p className="text-[12.5px] leading-snug text-text-muted">{t('services.hint')}</p>
      <div className="flex gap-2">
        <button type="submit" className="question-submit" disabled={!ready || busy}>{t('services.connectShort')}</button>
        <button type="button" className="question-skip" onClick={onCancel}>{t('menu.cancel')}</button>
      </div>
    </form>
  );
}

/** The setup panel a service's "+" opens: the address (editable), an access token when the service takes one, then connect. */
function ServiceSetup({ service, busy, error, load, onConnect, onClose }: { service: ServiceInfo; busy: boolean; error: string | null; load: (owner: string) => Promise<string | null>; onConnect: (input: { name: string; url: string; transport: string; token?: string }) => void; onClose: () => void }) {
  const [url, setUrl] = useState(service.url);
  const [token, setToken] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const ready = url.trim() !== '';
  return (
    <div className="plugin-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-label={t('services.setupTitle', { name: service.name })}
        className="plugin-detail"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onConnect({ name: service.id, url: url.trim(), transport: service.transport, ...(token.trim() ? { token: token.trim() } : {}) });
        }}
      >
        <div className="flex items-start gap-4">
          <Logo owner={service.owner} name={service.name} load={load} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[20px] font-semibold tracking-tight">{t('services.setupTitle', { name: service.name })}</h2>
            <p className="text-[13px] text-text-muted">{service.description}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('settings.close')} onClick={onClose}>
            <SymbolIcon name="close" />
          </button>
        </div>
        <label className="mt-5 block text-[13px] font-medium text-text">
          {t('services.address')}
          <input className="question-input mt-1.5 w-full font-normal" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        </label>
        {service.token && (
          <label className="mt-3 block text-[13px] font-medium text-text">
            {t('services.token')}
            <input className="question-input mt-1.5 w-full font-normal" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
        )}
        <p className="mt-3 text-[12.5px] leading-snug text-text-muted">{service.token ? t('services.tokenHint') : t('services.signinOnly')}</p>
        <p className="mt-2 text-[12.5px] leading-snug text-text-muted">{t('services.hint')}</p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="submit" className="question-submit inline-flex items-center gap-2" disabled={!ready || busy}>
            {busy && <span className="loading-ring size-3.5 border-[1.5px]" role="status" aria-label={t('services.connecting')} />}
            {t('services.connectShort')}
          </button>
          <button type="button" className="question-skip" onClick={onClose}>{t('menu.cancel')}</button>
        </div>
      </form>
    </div>
  );
}

/** Placeholder cards while the lists are first asked for. */
function Skeleton() {
  return (
    <div role="status" aria-label={t('chat.loading')} aria-busy="true">
      <span className="sr-only">{t('chat.loading')}</span>
      <div className="skeleton-line mb-3 h-4 w-32" />
      <ul className="plugin-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <li key={i} className="plugin-card" style={{ animationDelay: `${i * 40}ms` }}>
            <span className="skeleton-line size-10 shrink-0 !rounded-xl" />
            <span className="min-w-0 flex-1">
              <span className="skeleton-line mb-2 block h-3.5 w-2/5" />
              <span className="skeleton-line block h-3 w-4/5" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Plugins and skills of the agents: discover and install what the Claude marketplaces offer, switch installed plugins
 * on and off, and add skills (written here or taken from a Git repository). Everything shown is what is on this computer.
 */
export function PluginsPage({ api, onClose }: { api: Api; onClose: () => void }) {
  const cached = useMemo(() => api.cachedPlugins?.() ?? null, [api]);
  const [data, setData] = useState<PluginsOverview | null>(cached?.overview ?? null);
  const [services, setServices] = useState<ServiceInfo[]>(cached?.services ?? []);
  const [setup, setSetup] = useState<ServiceInfo | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PluginInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<'discover' | 'services' | 'installed'>('discover');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState<ReadonlySet<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [overview, list] = await Promise.all([api.plugins(), api.services().catch(() => [] as ServiceInfo[])]);
      setData(overview);
      setServices(list);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Runs one change; resolves to the error text when it failed (the notice shows it too). */
  const run = async (key: string, work: () => Promise<unknown>, done?: string): Promise<string | null> => {
    setBusy((b) => new Set(b).add(key));
    setNotice(null);
    try {
      await work();
      if (done) setNotice({ text: done });
      await load();
      return null;
    } catch (err) {
      const text = errorText(err instanceof ApiError ? err.code : 'internal');
      setNotice({ text, error: true });
      return text;
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(key);
        return next;
      });
    }
  };

  const q = query.trim().toLowerCase();
  const match = (p: PluginInfo) => q === '' || `${p.name} ${p.description} ${p.category ?? ''} ${p.author ?? ''}`.toLowerCase().includes(q);
  const groups = useMemo(() => {
    const byCategory = new Map<string, PluginInfo[]>();
    for (const p of data?.plugins ?? []) {
      if (!match(p)) continue;
      const key = p.category ?? '';
      byCategory.set(key, [...(byCategory.get(key) ?? []), p]);
    }
    return [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q]);
  const installed = (data?.plugins ?? []).filter((p) => p.installed && match(p));
  const skills = (data?.skills ?? []).filter((s) => q === '' || `${s.name} ${s.description}`.toLowerCase().includes(q));
  const connectedServices = services.filter((s) => s.connected);
  const shownServices = services.filter((s) => q === '' || `${s.name} ${s.description}`.toLowerCase().includes(q));
  const installedCount = (data?.plugins.filter((p) => p.installed).length ?? 0) + (data?.skills.length ?? 0) + connectedServices.length;

  const skillKey = (s: SkillInfo) => `${s.agent}/${s.name}`;
  const agentLabel = (id: string) => AGENTS.find((a) => a.id === id)?.label ?? id;

  return (
    <div className="plugins-page" role="region" aria-label={t('plugins.title')}>
      <div className="plugins-body">
        <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-[16rem] flex-[1_1_20rem]">
            <h1 className="text-[26px] font-semibold tracking-tight">{t('plugins.title')}</h1>
            <p className="mt-1 text-[14px] text-text-muted">{t('plugins.subtitle')}</p>
          </div>
          <label className="plugins-search">
            <SymbolIcon name="search" className="size-4 shrink-0 text-text-muted" />
            <input aria-label={t('plugins.search')} placeholder={t('plugins.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="icon-button" aria-label={t('agent.refresh')} title={t('agent.refresh')} onClick={() => void load()}>
            <SymbolIcon name="refresh" className="size-4" />
          </button>
          <button type="button" className="plugins-add-button" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            {t('plugins.addSkill')}
          </button>
          <button type="button" className="icon-button" aria-label={t('settings.close')} title={t('settings.close')} onClick={onClose}>
            <SymbolIcon name="close" />
          </button>
        </header>

        {adding && (
          <AddSkill
            api={api}
            onCancel={() => setAdding(false)}
            onDone={(text) => {
              setAdding(false);
              setNotice({ text });
              setTab('installed');
              void load();
            }}
          />
        )}
        {notice && (
          <p role={notice.error ? 'alert' : 'status'} className={`plugins-notice ${notice.error ? 'text-danger' : 'text-text'}`}>
            {notice.text}
          </p>
        )}

        <div className="panel-tabs plugins-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'discover'} onClick={() => setTab('discover')}>{t('plugins.discover')}</button>
          <button type="button" role="tab" aria-selected={tab === 'services'} onClick={() => setTab('services')}>{t('services.tab')}</button>
          <button type="button" role="tab" aria-selected={tab === 'installed'} onClick={() => setTab('installed')}>
            {t('plugins.installedTab', { count: installedCount })}
          </button>
        </div>

        {failed && <p role="alert" className="text-sm text-danger">{errorText('network')}</p>}
        {!data && !failed && <Skeleton />}

        {data && tab === 'discover' && (
          <div>
            {groups.length === 0 && <p className="text-sm text-text-muted">{t('plugins.none')}</p>}
            {groups.map(([category, list]) => {
              const key = category || 'other';
              const expanded = q !== '' || more.has(key);
              const shown = expanded ? list.slice(0, SEARCH_LIMIT) : list.slice(0, PER_CATEGORY);
              return (
                <section key={key} className="mb-8" aria-label={category ? prettyName(category) : t('plugins.other')}>
                  <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-medium">
                    {category ? prettyName(category) : t('plugins.other')}
                    <span className="text-xs font-normal text-text-muted">{list.length}</span>
                  </h2>
                  <ul className="plugin-grid">
                    {shown.map((p) => (
                      <Card key={p.id} plugin={p} load={api.pluginIcon} onOpen={() => setSelected(p)} busy={busy.has(p.id)} onInstall={() => void run(p.id, () => api.pluginAction('install', p.id), t('plugins.installedDone', { name: prettyName(p.name) }))} />
                    ))}
                  </ul>
                  {!expanded && list.length > PER_CATEGORY && (
                    <button type="button" className="mt-2 text-[13px] text-text-muted hover:text-text" onClick={() => setMore((m) => new Set(m).add(key))}>
                      {t('plugins.showMore', { count: list.length - PER_CATEGORY })}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {data && tab === 'services' && (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-[13.5px] text-text-muted">{t('services.subtitle')}</p>
              <button type="button" className="plugins-add-button" aria-expanded={connecting} onClick={() => setConnecting((v) => !v)}>{t('services.custom')}</button>
            </div>
            {connecting && (
              <ConnectForm
                busy={busy.has('service:new')}
                onCancel={() => setConnecting(false)}
                onConnect={(input) => {
                  void run(
                    'service:new',
                    async () => {
                      await api.connectService(input);
                      setConnecting(false);
                    },
                    t('services.connectedDone', { name: input.name }),
                  );
                }}
              />
            )}
            {shownServices.length === 0 && <p className="text-sm text-text-muted">{t('plugins.none')}</p>}
            <ul className="plugin-grid mt-2">
              {shownServices.map((s) => (
                <ServiceCard
                  key={s.id}
                  service={s}
                  load={api.pluginIcon}
                  busy={busy.has(`service:${s.id}`)}
                  onSetup={() => {
                    setSetupError(null);
                    setSetup(s);
                  }}
                  onDisconnect={() => void run(`service:${s.id}`, () => api.disconnectService(s.id), t('services.disconnectedDone', { name: s.name }))}
                />
              ))}
            </ul>
          </div>
        )}

        {data && tab === 'installed' && (
          <div>
            <section className="mb-8">
              <h2 className="mb-2 text-[15px] font-medium">{t('plugins.plugins')}</h2>
              {installed.length === 0 ? (
                <p className="text-sm text-text-muted">{t('plugins.noneInstalled')}</p>
              ) : (
                <ul className="settings-card">
                  {installed.map((p) => (
                    <li key={p.id} className="settings-row">
                      <Logo owner={p.owner} name={p.name} load={api.pluginIcon} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{prettyName(p.name)} {p.version && <span className="text-xs font-normal text-text-muted">{p.version}</span>}</p>
                        <p className="truncate text-[13px] text-text-muted">{p.description || p.marketplace}</p>
                      </div>
                      <Switch label={t('plugins.enabled', { name: prettyName(p.name) })} checked={p.enabled !== false} busy={busy.has(p.id)} onChange={(on) => void run(p.id, () => api.pluginAction(on ? 'enable' : 'disable', p.id))} />
                      <button type="button" className="icon-button" aria-label={t('plugins.uninstall', { name: prettyName(p.name) })} title={t('plugins.uninstallShort')} disabled={busy.has(p.id)} onClick={() => void run(p.id, () => api.pluginAction('uninstall', p.id), t('plugins.removedDone', { name: prettyName(p.name) }))}>
                        <SymbolIcon name="close" className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {connectedServices.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-2 text-[15px] font-medium">{t('services.tab')}</h2>
                <ul className="settings-card">
                  {connectedServices.map((s) => (
                    <li key={s.id} className="settings-row">
                      <Logo owner={s.owner} name={s.name} load={api.pluginIcon} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{s.name}</p>
                        <p className="truncate text-[13px] text-text-muted">{s.url || s.description}</p>
                      </div>
                      <button type="button" className="icon-button" aria-label={t('services.disconnect', { name: s.name })} title={t('services.disconnectShort')} disabled={busy.has(`service:${s.id}`)} onClick={() => void run(`service:${s.id}`, () => api.disconnectService(s.id), t('services.disconnectedDone', { name: s.name }))}>
                        <SymbolIcon name="close" className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="mb-8">
              <h2 className="mb-1 text-[15px] font-medium">{t('plugins.skills')}</h2>
              <p className="mb-2 text-[13px] text-text-muted">{t('plugins.skillsHint')}</p>
              {skills.length === 0 ? (
                <p className="text-sm text-text-muted">{t('plugins.noSkills')}</p>
              ) : (
                <ul className="settings-card">
                  {skills.map((s) => (
                    <li key={`${skillKey(s)}:${s.source}`} className="settings-row">
                      <Logo owner={s.owner} name={s.name} load={api.pluginIcon} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-[14px] font-medium">
                          {s.name}
                          <span className="plugin-chip">{agentLabel(s.agent)}</span>
                          <span className="plugin-chip">{t(`plugins.source.${s.source}`)}</span>
                        </p>
                        <p className="truncate text-[13px] text-text-muted" title={s.description}>{s.description}</p>
                      </div>
                      {s.removable &&
                        (confirmRemove === skillKey(s) ? (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <button type="button" className="question-skip" onClick={() => setConfirmRemove(null)}>{t('menu.cancel')}</button>
                            <button type="button" className="context-danger" disabled={busy.has(skillKey(s))} onClick={() => { setConfirmRemove(null); void run(skillKey(s), () => api.removeSkill(s.agent, s.name), t('plugins.removedDone', { name: s.name })); }}>
                              {t('menu.delete')}
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="icon-button" aria-label={t('plugins.removeSkill', { name: s.name })} title={t('menu.delete')} onClick={() => setConfirmRemove(skillKey(s))}>
                            <SymbolIcon name="close" className="size-4" />
                          </button>
                        ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
      {setup && (
        <ServiceSetup
          service={setup}
          busy={busy.has(`service:${setup.id}`)}
          error={setupError}
          load={api.pluginIcon}
          onClose={() => setSetup(null)}
          onConnect={(input) => {
            setSetupError(null);
            void run(`service:${setup.id}`, () => api.connectService(input), t('services.connectedDone', { name: setup.name })).then((error) => (error ? setSetupError(error) : setSetup(null)));
          }}
        />
      )}
      {selected && (
        <Detail
          plugin={data?.plugins.find((p) => p.id === selected.id) ?? selected}
          busy={busy.has(selected.id)}
          load={api.pluginIcon}
          onClose={() => setSelected(null)}
          onInstall={() => void run(selected.id, () => api.pluginAction('install', selected.id), t('plugins.installedDone', { name: prettyName(selected.name) }))}
          onUninstall={() => void run(selected.id, () => api.pluginAction('uninstall', selected.id), t('plugins.removedDone', { name: prettyName(selected.name) }))}
        />
      )}
    </div>
  );
}
