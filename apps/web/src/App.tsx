import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createApi, ApiError, type AgentInfo } from './lib/api.ts';
import { createConnection, type Connection, type ConnectionState } from './lib/connection.ts';
import { loadToken } from './lib/token.ts';
import { addLocalUserMessage, applyEvent, initialState, type Item, type SessionState } from './lib/sessionState.ts';
import { errorText, t, type MessageKey } from './i18n/index.ts';

const input =
  'rounded border border-neutral-300 bg-white px-2 py-1 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';
const button =
  'rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50 dark:bg-blue-500';
const secondaryButton =
  'rounded border border-neutral-400 px-3 py-1 disabled:opacity-50 dark:border-neutral-600';

export function App() {
  const [token] = useState(loadToken);
  if (token === null) return <Shell><p>{t('token.missing')}</p></Shell>;
  return <Client token={token} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-white p-4 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <h1 className="text-xl font-semibold">{t('app.title')}</h1>
      {children}
    </main>
  );
}

function Client({ token }: { token: string }) {
  const [api] = useState(() => createApi(token));
  const conn = useRef<Connection | null>(null);
  const activeId = useRef<string | null>(null);

  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentId, setAgentId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState>(initialState);
  const [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fail = (err: unknown): void =>
    setErrorMessage(errorText(err instanceof ApiError ? err.code : 'internal'));

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const c = createConnection({ url: `${protocol}//${location.host}/ws`, token });
    conn.current = c;
    const offState = c.onState(setConnState);
    const offMessage = c.onMessage((m) => {
      if (m.type === 'event') {
        if (m.stored.sessionId === activeId.current) setSession((s) => applyEvent(s, m.stored));
      } else if (m.type === 'error') {
        setErrorMessage(errorText(m.code));
      }
    });
    return () => {
      offState();
      offMessage();
      c.close();
      conn.current = null;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    api
      .agents()
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        setAgentId((current) => current || (list.find((a) => a.installed)?.id ?? ''));
      })
      .catch((err: unknown) => {
        if (!cancelled) fail(err);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const startSession = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setStarting(true);
    setErrorMessage(null);
    try {
      const path = projectPath.trim();
      const known = (await api.projects()).find((p) => p.path === path);
      const project = known ?? (await api.addProject(projectName.trim(), path));
      const row = await api.createSession(project.id, agentId);
      activeId.current = row.id;
      setSession(initialState());
      setSessionId(row.id);
      // The replay starts from our own last seq (0 for a new session).
      conn.current?.send({ type: 'subscribe', sessionId: row.id, afterSeq: 0 });
    } catch (err) {
      fail(err);
    } finally {
      setStarting(false);
    }
  };

  const send = (e: FormEvent): void => {
    e.preventDefault();
    const text = message.trim();
    if (!sessionId || !text) return;
    // The server journals no user_message for prompts, so the item is added locally.
    if (conn.current?.send({ type: 'prompt', sessionId, text })) {
      setSession((s) => addLocalUserMessage(s, text));
      setMessage('');
    } else {
      setErrorMessage(errorText('network'));
    }
  };

  const respond = (requestId: string, optionId: string | null): void => {
    if (!sessionId) return;
    if (!conn.current?.send({ type: 'permission_response', sessionId, requestId, optionId })) {
      setErrorMessage(errorText('network'));
    }
  };

  const running = session.status === 'running';
  const canStart = !starting && agentId !== '' && projectName.trim() !== '' && projectPath.trim() !== '';

  return (
    <Shell>
      <div className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-400">
        <span>
          {t('connection.label')}: {t(`connection.${connState}`)}
        </span>
        {sessionId && (
          <span>
            {t('status.label')}: {t(`status.${session.status}`)}
          </span>
        )}
      </div>

      {errorMessage && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded border border-red-400 bg-red-50 p-2 text-red-900 dark:bg-red-950 dark:text-red-200">
          <span>{errorMessage}</span>
          <button type="button" className={secondaryButton} onClick={() => setErrorMessage(null)}>
            {t('error.dismiss')}
          </button>
        </div>
      )}

      <form onSubmit={startSession} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm">
          {t('setup.agent')}
          <select className={input} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.length === 0 && <option value="">{t('setup.agentNone')}</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.installed}>
                {a.installed ? a.label : `${a.label} (${t('setup.agentNotInstalled')})`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          {t('setup.projectName')}
          <input className={input} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </label>
        <label className="flex min-w-64 flex-1 flex-col text-sm">
          {t('setup.projectPath')}
          <input className={input} value={projectPath} onChange={(e) => setProjectPath(e.target.value)} />
        </label>
        <button type="submit" className={button} disabled={!canStart}>
          {starting ? t('setup.starting') : t('setup.start')}
        </button>
      </form>

      {sessionId && (
        <>
          <ul className="flex flex-col gap-2">
            {session.items.map((item, index) => (
              <li key={index}>
                <ItemView item={item} onRespond={respond} />
              </li>
            ))}
          </ul>
          <form onSubmit={send} className="flex gap-2">
            <input
              className={`${input} flex-1`}
              value={message}
              placeholder={t('chat.placeholder')}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button type="submit" className={button} disabled={!message.trim() || running}>
              {t('chat.send')}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={!running}
              onClick={() => conn.current?.send({ type: 'cancel', sessionId })}
            >
              {t('chat.cancel')}
            </button>
          </form>
        </>
      )}
    </Shell>
  );
}

function Labeled({ label, children }: { label: MessageKey; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase text-neutral-500">{t(label)}</span>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function ItemView({ item, onRespond }: { item: Item; onRespond: (requestId: string, optionId: string | null) => void }) {
  switch (item.kind) {
    case 'user':
      return <Labeled label="item.user">{item.text}</Labeled>;
    case 'agent':
      return <Labeled label="item.agent">{item.text}</Labeled>;
    case 'thought':
      return (
        <div className="italic text-neutral-500">
          <Labeled label="item.thought">{item.text}</Labeled>
        </div>
      );
    case 'tool':
      return (
        <Labeled label="item.tool">
          {item.title} ({item.status})
        </Labeled>
      );
    case 'unsupported':
      return <Labeled label="item.unsupported">{item.sessionUpdate}</Labeled>;
    case 'permission':
      return (
        <div className="rounded border border-amber-400 p-2">
          <Labeled label="permission.heading">{item.title}</Labeled>
          {item.resolved ? (
            <p className="text-sm text-neutral-500">{t('permission.resolved')}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.options.map((o) => (
                <button key={o.id} type="button" className={button} onClick={() => onRespond(item.requestId, o.id)}>
                  {o.name}
                </button>
              ))}
              <button type="button" className={secondaryButton} onClick={() => onRespond(item.requestId, null)}>
                {t('permission.reject')}
              </button>
            </div>
          )}
        </div>
      );
  }
}
