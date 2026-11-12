import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ServerSettings } from "./lib/api.ts";
import { App, Client } from "./App.tsx";
import { en } from "./i18n/en.ts";
import { setLanguageForTests } from "./i18n/index.ts";
import { createWorkspaceApi } from "./lib/workspaceApi.ts";
import { ApiError, type Api, type SessionInfo } from "./lib/api.ts";
import type { SocketLike } from "./lib/connection.ts";
import {
  createSessionsStore,
  type SessionsStore,
} from "./lib/sessionsStore.ts";

vi.mock('./components/TerminalPane.tsx',()=>({TerminalPane:()=>null}));

// Deterministic: no real Shiki in jsdom (Ruling K).
vi.mock("./lib/highlight.ts", () => ({
  highlightTokens: vi.fn(async () => null),
}));

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    act(() => this.onopen?.({}));
  }
  drop(): void {
    this.readyState = 3;
    act(() => this.onclose?.({}));
  }
  /** One WS message, then the frame it is rendered in (the store coalesces event notifications per frame). */
  receive(msg: unknown): void {
    act(() => this.onmessage?.({ data: JSON.stringify(msg) }));
    act(() => store.flush());
  }
  ofType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

// jsdom has no layout: give the virtualized list a viewport and rows a height (as in MessageList.test).
const saved = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  const proto = HTMLElement.prototype;
  for (const name of [
    "clientHeight",
    "clientWidth",
    "offsetHeight",
    "offsetWidth",
  ]) {
    saved.set(name, Object.getOwnPropertyDescriptor(proto, name));
  }
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get: () => 40,
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get: () => 800,
  });
});
afterAll(() => {
  const proto = HTMLElement.prototype;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(proto, name, descriptor);
    else delete (proto as unknown as Record<string, unknown>)[name];
  }
});

const row = (id: string, createdAt = Date.now() - 60_000): SessionInfo => ({
  id,
  projectId: "p1",
  agentId: "claude",
  createdAt,
  title: null,
});

function fakeApi(sessions: SessionInfo[] = [row("s1")]) {
  const list = [...sessions];
  return {
    agents: vi.fn(async () => [
      { id: "claude", label: "Claude Code", installed: true },
    ]),
    projects: vi.fn(async () => [
      { id: "p1", name: "alpha", path: "/home/u/alpha" },
    ]),
    agentOptions: vi.fn(async () => []),
    usage: vi.fn(async () => []),
    plugins: vi.fn(async () => ({ plugins: [], skills: [] })),
    services: vi.fn(async () => []),
    connectService: vi.fn(async () => ({ ok: true as const })),
    disconnectService: vi.fn(async () => ({ ok: true as const })),
    tasks: vi.fn(async () => []),
    createTask: vi.fn(async () => { throw new Error('unused'); }),
    updateTask: vi.fn(async () => ({ ok: true as const })),
    deleteTask: vi.fn(async () => ({ ok: true as const })),
    runTask: vi.fn(async () => ({ sessionId: 'new' })),
    memory: vi.fn(async () => []),
    addMemory: vi.fn(async () => { throw new Error('unused'); }),
    deleteMemory: vi.fn(async () => ({ ok: true as const })),
    importMemory: vi.fn(async () => ({ added: 0, skipped: 0 })),
    localImage: vi.fn(async () => null),
    verifyConfig: vi.fn(async () => ({ config: { enabled: true, autoFix: true, maxFixes: 2, checks: [] }, suggested: [] })),
    saveVerifyConfig: vi.fn(async (_id: string, config: { enabled: boolean; autoFix: boolean; maxFixes: number; checks: { name: string; command: string }[] }) => config),
    runChecks: vi.fn(async () => ({ ok: true as const })),
    usageHistory: vi.fn(async () => ({ from: '2026-01-01', to: '2026-01-02', days: [], sources: [], generatedAt: 0 })),
    askForChecks: vi.fn(async () => ({ sessionId: 's-checks' })),
    exportMemory: vi.fn(async () => undefined),
    pluginIcon: vi.fn(async () => null),
    cachedPlugins: vi.fn(() => null),
    prefetchPlugins: vi.fn(async () => {}),
    pluginAction: vi.fn(async () => ({ ok: true as const })),
    addSkill: vi.fn(async () => ({ ok: true as const })),
    addSkillsFromGit: vi.fn(async () => ({ added: [] as string[] })),
    removeSkill: vi.fn(async () => ({ ok: true as const })),
    renameSession: vi.fn(async () => ({ ok: true as const })),
    deleteSession: vi.fn(async () => ({ ok: true as const })),
    renameProject: vi.fn(async () => ({ ok: true as const })),
    deleteProject: vi.fn(async () => ({ ok: true as const })),
    settings: vi.fn(async () => ({ planAutoApprove: true, defaultApproval: "ask" as const, agentGuide: true, scoutSubagent: false, scoutModel: 'gemini-3.8-flash', scoutEffort: 'default', claudeSubagent: false, claudeModel: 'sonnet', claudeEffort: 'default' })),
    updateSettings: vi.fn(async (patch: Partial<ServerSettings>) => ({ planAutoApprove: true, defaultApproval: "ask" as const, agentGuide: true, scoutSubagent: false, scoutModel: 'gemini-3.8-flash', scoutEffort: 'default', claudeSubagent: false, claudeModel: 'sonnet', claudeEffort: 'default', ...patch })),
    projectSessions: vi.fn(async () => [...list]),
    addProject: vi.fn(async (name: string, path: string) => ({
      id: "p2",
      name,
      path,
    })),
    createSession: vi.fn(async (projectId: string, agentId: string) => {
      const created = { ...row("new"), projectId, agentId };
      list.push(created);
      return created;
    }),
  } satisfies Api;
}

let sockets: FakeSocket[];
/** Frames never run on their own: `FakeSocket.receive` flushes explicitly. */
let store: SessionsStore;
const createSocket = () => {
  const s = new FakeSocket();
  sockets.push(s);
  return s;
};
const socket = () => sockets[sockets.length - 1]!;

async function renderClient(api = fakeApi(), workspaceOverrides: Partial<ReturnType<typeof createWorkspaceApi>> = {}) {
  render(
    <Client
      token="t"
      api={api}
      workspaceApi={{
        ...createWorkspaceApi("t"),
          ...workspaceOverrides,
        folders: async (path = "/home/u") => ({
          path,
          parent: "/home",
          entries: [],
        }),
      }}
      createSocket={createSocket}
      store={store}
    />,
  );
  // Let the catalog requests settle so the sidebar is filled.
  await screen.findByRole("region", { name: "alpha" });
  return api;
}

const event = (seq: number, sessionId: string, e: Record<string, unknown>) => ({
  type: "event",
  stored: { seq, sessionId, ts: 0, event: e },
});
const box = () =>
  screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

beforeEach(() => {
  setLanguageForTests("en");
  sockets = [];
  store = createSessionsStore({ schedule: () => () => {} });
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => setLanguageForTests(null));

describe("App", () => {
  it("without a token shows the token page", () => {
    render(<App />);
    expect(screen.getByText(en["token.missing"])).toBeInTheDocument();
  });
});

describe("Client", () => {
  it("without a remembered session shows the empty state and subscribes to nothing", async () => {
    await renderClient();
    socket().open();
    expect(
      screen.getByRole("heading", { name: /What should we build in\s+alpha\s*\?/ }),
    ).toBeInTheDocument();
    expect(socket().sent).toEqual([]);
  });

  it("a restored session subscribes from seq 0 and shows its events", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    expect(socket().sent).toEqual([
      { type: "subscribe", sessionId: "s1", afterSeq: 0 },
    ]);
    socket().receive({ type: "subscribed", sessionId: "s1", lastSeq: 2 });
    socket().receive(
      event(1, "s1", { type: "user_message", text: "Earlier question" }),
    );
    socket().receive(
      event(2, "s1", { type: "agent_message", text: "Earlier answer" }),
    );
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
    // The sidebar names the session after its first message and marks it active.
    expect(
      screen.getAllByRole("button", { name: /Earlier question/ })[0]!,
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByText("Claude Code", { selector: "header span" }),
    ).toBeInTheDocument();
  });

  it("does not show subagent pill in header", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive({ type: "subscribed", sessionId: "s1", lastSeq: 2 });
    socket().receive(
      event(1, "s1", {
        type: "tool_call",
        id: "t1",
        title: "invoke_subagent",
        kind: "other",
        status: "in_progress",
        content: [],
        rawInput: { Role: "Explorer", Prompt: "Explore" },
      }),
    );
    const header = document.querySelector("header")!;
    expect(within(header).queryByRole("button", { name: /Sub-agents/ })).not.toBeInTheDocument();
  });

  it("allows drafting message while subagent is running but disables send, and shows SubagentWait", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive({ type: "subscribed", sessionId: "s1", lastSeq: 3 });
    socket().receive(
      event(1, "s1", {
        type: "tool_call",
        id: "call_sub_1",
        title: "invoke_subagent",
        kind: "other",
        status: "in_progress",
        content: [],
        rawInput: { Role: "Architect", Prompt: "Review architecture" },
      }),
    );
    socket().receive(
      event(2, "s1", {
        type: "tool_call_update",
        id: "call_sub_1",
        patch: { status: "completed" },
      }),
    );
    socket().receive(
      event(3, "s1", {
        type: "status",
        status: "ready",
      }),
    );

    // Subagent is running (no output yet), so SubagentWait is visible, textarea is enabled for drafting, but send is disabled
    const waitEl = document.querySelector(".subagent-wait");
    expect(waitEl).toBeInTheDocument();
    expect(waitEl).toHaveTextContent(/Waiting for sub-agent…/);
    expect(box()).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("title", "Waiting for sub-agent… Please wait.");

    // Now subagent completes with report
    socket().receive(
      event(4, "s1", {
        type: "tool_call_update",
        id: "call_sub_1",
        patch: { status: "completed", rawOutput: "Architecture looks good" },
      }),
    );

    // Composer becomes enabled, auto-continue fires with continuation message
    expect(box()).not.toBeDisabled();
    expect(document.querySelector(".subagent-wait")).not.toBeInTheDocument();
    expect(socket().sent).toContainEqual({
      type: "prompt",
      sessionId: "s1",
      text: expect.stringContaining("Architecture looks good"),
    });
  });

  it("a restored session the server does not know is quietly forgotten", async () => {
    sessionStorage.setItem("somecode.activeSession", "gone");
    await renderClient();
    socket().open();
    socket().receive({
      type: "error",
      code: "not_found",
      message: "unknown session",
    });
    expect(
      screen.getByRole("heading", { name: /What should we build in\s+alpha\s*\?/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("somecode.activeSession")).toBeNull();
  });

  it("other server errors show a dismissible banner", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive({ type: "subscribed", sessionId: "s1", lastSeq: 0 });
    socket().receive({
      type: "error",
      code: "turn_in_progress",
      message: "busy",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      en["error.turn_in_progress"],
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Send writes a prompt, shows it at once and clears the draft", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    await userEvent.type(box(), "Hello agent{Enter}");
    expect(socket().ofType("prompt")).toEqual([
      { type: "prompt", sessionId: "s1", text: "Hello agent" },
    ]);
    expect(box().value).toBe("");
    expect(screen.getAllByText("Hello agent").length).toBeGreaterThan(0);
  });

  it("a failed send keeps the draft and shows the network banner", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().drop();
    await userEvent.type(box(), "Lost message");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(box().value).toBe("Lost message");
    expect(screen.getByRole("alert")).toHaveTextContent(en["error.network"]);
    expect(
      screen.queryByText("Lost message", { selector: "p" }),
    ).not.toBeInTheDocument();
  });

  it("a prompt over the size limit is refused with a banner and keeps the draft; one just under it sends", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    const send = () =>
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const over = "a".repeat(900_001);
    fireEvent.change(box(), { target: { value: over } });
    send();
    expect(socket().ofType("prompt")).toEqual([]);
    expect(box().value).toBe(over);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This message is longer than 900 000 bytes, so shorten it or split it into several messages.",
    );
    expect(document.querySelectorAll("[data-item-key]")).toHaveLength(0); // no optimistic item

    // Multi-byte text counts in UTF-8 bytes: 450 001 × 'ğ' (2 bytes each) is over the limit too.
    fireEvent.change(box(), { target: { value: "ğ".repeat(450_001) } });
    send();
    expect(socket().ofType("prompt")).toEqual([]);

    const under = "a".repeat(900_000);
    fireEvent.change(box(), { target: { value: under } });
    send();
    expect(socket().ofType("prompt")).toEqual([
      { type: "prompt", sessionId: "s1", text: under },
    ]);
    expect(box().value).toBe("");
    expect(document.querySelectorAll('[data-item-key^="local-"]')).toHaveLength(
      1,
    );
  });

  it("a permission card sends exactly one response, even on a double click", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive(
      event(1, "s1", {
        type: "permission_request",
        requestId: "r1",
        toolCallId: "t1",
        title: "Run ls",
        options: [
          { id: "allow", name: "Allow once", kind: "allow_once" },
          { id: "deny", name: "Reject", kind: "reject_once" },
        ],
      }),
    );
    // Both the header and the active sidebar row show it.
    expect(
      screen.getAllByRole("img", { name: "Waiting for permission" }),
    ).toHaveLength(3);
    const allow = screen.getByRole("button", { name: "Allow once" });
    fireEvent.click(allow);
    fireEvent.click(allow);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(socket().ofType("permission_response")).toEqual([
      {
        type: "permission_response",
        sessionId: "s1",
        requestId: "r1",
        optionId: "allow",
      },
    ]);
    expect(allow).toBeDisabled();
  });

  it("a permission answer that cannot be sent stays answerable", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive(
      event(1, "s1", {
        type: "permission_request",
        requestId: "r1",
        toolCallId: "t1",
        title: "Run ls",
        options: [{ id: "allow", name: "Allow once", kind: "allow_once" }],
      }),
    );
    socket().drop();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(screen.getByRole("alert")).toHaveTextContent(en["error.network"]);
    expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled();
  });

  it("Ctrl+B toggles the sidebar and remembers the choice", async () => {
    await renderClient();
    expect(
      screen.getByRole("navigation", { name: "Sessions" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(
      screen.queryByRole("navigation", { name: "Sessions" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("somecode.sidebarOpen")).toBe("0");
    expect(
      screen.getByRole("button", { name: "Toggle sidebar" }),
    ).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(
      screen.getByRole("navigation", { name: "Sessions" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("somecode.sidebarOpen")).toBe("1");
  });

  it("New chat is an inline screen and keeps IME shortcut handling", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, isComposing: true });
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /What should we build in\s+alpha\s*\?/ }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem("somecode.activeSession")).toBeNull();
  });

  it("keeps the first draft when session startup fails", async () => {
    const api = fakeApi();
    api.createSession.mockRejectedValueOnce(
      new ApiError("agent_not_installed"),
    );
    await renderClient(api);
    socket().open();
    await userEvent.type(box(), "Keep my idea{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en["error.agent_not_installed"],
    );
    expect(box()).toHaveValue("Keep my idea");
    expect(socket().ofType("prompt")).toEqual([]);
  });

  it("switching sessions clears the error banner", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient(fakeApi([row("s1", Date.now() - 120_000), row("s2")]));
    socket().open();
    socket().receive({
      type: "error",
      code: "turn_in_progress",
      message: "busy",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      en["error.turn_in_progress"],
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /Claude Code · 1 min\. ago/ })[0]!,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("switching sessions resumes from the last seen seq and keeps each draft", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient(fakeApi([row("s1", Date.now() - 120_000), row("s2")]));
    socket().open();
    socket().receive(
      event(1, "s1", { type: "user_message", text: "First session" }),
    );
    socket().receive(event(2, "s1", { type: "agent_message", text: "reply" }));
    await userEvent.type(box(), "draft one");
    await userEvent.click(
      screen.getAllByRole("button", { name: /Claude Code · 1 min\. ago/ })[0]!,
    );
    expect(sessionStorage.getItem("somecode.activeSession")).toBe("s2");
    expect(box().value).toBe("");
    await userEvent.click(
      screen.getAllByRole("button", { name: /First session/ })[0]!,
    );
    expect(box().value).toBe("draft one");
    expect(socket().ofType("subscribe")).toEqual([
      { type: "subscribe", sessionId: "s1", afterSeq: 0 },
      { type: "subscribe", sessionId: "s2", afterSeq: 0 },
      { type: "subscribe", sessionId: "s1", afterSeq: 2 },
    ]);
  });

  it("the first message creates a session, subscribes and sends once after startup", async () => {
    const api = await renderClient();
    socket().open();
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    await userEvent.type(box(), "Build this feature{Enter}");
    await waitFor(() =>
      expect(api.createSession).toHaveBeenCalledExactlyOnceWith("p1", "claude"),
    );
    await waitFor(() =>
      expect(socket().ofType("prompt")).toEqual([
        { type: "prompt", sessionId: "new", text: "Build this feature" },
      ]),
    );
    socket().receive(
      event(1, "new", { type: "user_message", text: "Build this feature" }),
    );
    await waitFor(() =>
      expect(sessionStorage.getItem("somecode.activeSession")).toBe("new"),
    );
    expect(api.addProject).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("somecode.activeSession")).toBe("new");
    expect(socket().ofType("subscribe")).toContainEqual({
      type: "subscribe",
      sessionId: "new",
      afterSeq: 0,
    });
    expect(box()).toHaveValue("");
  });

  it("folder browsing selects a new project before the first message", async () => {
    const api = await renderClient();
    socket().open();
    // The workspace chip of the new-chat page (the sidebar has a project toggle with the same name).
    await userEvent.click(within(screen.getByRole("main")).getAllByRole("button", { name: "alpha" })[0]!);
    const path = await screen.findByRole("textbox", { name: "Folder path" });
    fireEvent.change(path, { target: { value: "/home/u/beta" } });
    await userEvent.click(screen.getByRole("button", { name: "Open folder" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Use this folder" }),
    );
    await userEvent.type(box(), "Hello{Enter}");
    await waitFor(() =>
      expect(api.addProject).toHaveBeenCalledWith("beta", "/home/u/beta"),
    );
    expect(api.createSession).toHaveBeenCalledWith("p2", "claude");
  });

  it("a slow first start never takes focus back after the user navigates", async () => {
    const api = fakeApi();
    let finish!: (row: SessionInfo) => void;
    api.createSession.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    await renderClient(api);
    socket().open();
    await userEvent.type(box(), "Background idea{Enter}");
    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    await userEvent.click(
      screen.getAllByRole("button", { name: /Claude Code ·/ })[0]!,
    );
    await act(async () => finish(row("new")));
    expect(sessionStorage.getItem("somecode.activeSession")).toBe("s1");
    expect(socket().ofType("prompt")).toEqual([]);
    expect(store.getDraft("new")).toBe("Background idea");
  });
  it("server rejection of the first prompt retains its draft for retry", async () => {
    const api = await renderClient();
    socket().open();
    await userEvent.type(box(), "My original idea{Enter}");
    await waitFor(() => expect(socket().ofType("prompt")).toHaveLength(1));
    socket().receive({
      type: "error",
      code: "disconnected",
      message: "agent exited",
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(box()).toHaveValue("My original idea");
    expect(
      screen.getByRole("heading", { name: /What should we build in\s+alpha\s*\?/ }),
    ).toBeInTheDocument();
  });
  it("sign in (from Settings, Agents) opens a panel before any chat is selected", async () => {
    await renderClient();
    socket().open();
    await userEvent.keyboard("{Control>},{/Control}");
    await userEvent.click(await screen.findByRole("tab", { name: "Agents" }));
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "Sign in" }),
      ).getAllByText("claude · Sign in").length,
    ).toBeGreaterThan(0);
  });

  it('resumes a disconnected first session before retrying the preserved draft',async()=>{
    const resume=vi.fn(async()=>({}));
    await renderClient(fakeApi(),{resume});socket().open();
    await userEvent.type(box(),'Keep working{Enter}');
    await waitFor(()=>expect(socket().ofType('prompt')).toHaveLength(1));
    socket().receive({type:'error',code:'disconnected',message:'gone'});
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button',{name:'Send'}));
    await waitFor(()=>expect(resume).toHaveBeenCalledExactlyOnceWith('new'));
    await waitFor(()=>expect(socket().ofType('prompt')).toHaveLength(2));
    socket().receive(event(1,'new',{type:'user_message',text:'Keep working'}));
    await waitFor(()=>expect(sessionStorage.getItem('somecode.activeSession')).toBe('new'));
  });

  it("a lost agent is reconnected on its own, without a click", async () => {
    const resume = vi.fn(async () => ({}));
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient(fakeApi(), { resume });
    socket().open();
    socket().receive(event(1, "s1", { type: "status", status: "disconnected" }));
    await waitFor(() => expect(resume).toHaveBeenCalledWith("s1"), { timeout: 3000 });
  });

  it("a disconnected session disables the composer", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive(
      event(1, "s1", { type: "status", status: "disconnected" }),
    );
    expect(box()).toBeDisabled();
    expect(
      screen.getAllByRole("img", { name: "Agent disconnected" }),
    ).toHaveLength(3);
  });
});

describe("config chips", () => {
  const options = (model: string) => [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      currentValue: "auto",
      choices: ["default", "plan", "auto"].map((value) => ({
        value,
        name: value,
      })),
    },
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: model,
      choices: ["sonnet", "opus"].map((value) => ({ value, name: value })),
    },
  ];

  async function openSession() {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive({ type: "subscribed", sessionId: "s1", lastSeq: 0 });
    socket().receive(
      event(1, "s1", { type: "config_options", options: options("sonnet") }),
    );
  }

  async function choose(
    user: ReturnType<typeof userEvent.setup>,
    chip: string,
    item: string,
  ) {
    await user.click(screen.getByRole("button", { name: chip }));
    await user.click(screen.getByRole("menuitemradio", { name: item }));
  }

  it("shows the agent options, sends set_config and changes only when the agent confirms", async () => {
    await openSession();
    const user = userEvent.setup();
    await choose(user, "Model: sonnet", "opus");
    expect(socket().ofType("set_config")).toEqual([
      { type: "set_config", sessionId: "s1", configId: "model", value: "opus" },
    ]);
    const chip = screen.getByRole("button", { name: "Model: sonnet" });
    expect(chip).toHaveAttribute("aria-busy", "true");
    socket().receive(
      event(2, "s1", { type: "config_options", options: options("opus") }),
    );
    expect(screen.getByRole("button", { name: "Model: opus" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "Model: sonnet" }),
    ).not.toBeInTheDocument();
  });

  it("shows a banner and keeps the old value when the agent rejects the change", async () => {
    await openSession();
    const user = userEvent.setup();
    await choose(user, "Model: sonnet", "opus");
    socket().receive({
      type: "error",
      code: "bad_request",
      message: "invalid value",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      en["error.bad_request"],
    );
    const chip = screen.getByRole("button", { name: "Model: sonnet" });
    expect(chip).toHaveAttribute("aria-busy", "false");
  });

  it("disables the chips while a turn runs", async () => {
    await openSession();
    socket().receive(event(2, "s1", { type: "status", status: "running" }));
    expect(
      screen.getByRole("button", { name: "Model: sonnet" }),
    ).toBeDisabled();
    socket().receive(event(3, "s1", { type: "status", status: "ready" }));
    expect(screen.getByRole("button", { name: "Model: sonnet" })).toBeEnabled();
  });

  it("shows no chip row for an agent that reports no options", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    socket().receive({ type: "subscribed", sessionId: "s1", lastSeq: 0 });
    expect(
      screen.queryByRole("group", { name: "Session options" }),
    ).not.toBeInTheDocument();
  });
});

describe("sign-in hint", () => {
  it("shows the agent's sign-in command under an auth_required failure", async () => {
    const api = fakeApi();
    api.agents.mockImplementation(async () => [
      {
        id: "claude",
        label: "Claude Code",
        installed: true,
        auth: "signed_out",
        signInHint: "claude auth login",
      },
    ]);
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient(api);
    socket().open();
    socket().receive({ type: "subscribed", sessionId: "s1", lastSeq: 0 });
    socket().receive(
      event(1, "s1", {
        type: "turn_end",
        stopReason: "error",
        error: { code: "auth_required", message: "x" },
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("claude auth login")).toBeInTheDocument();
  });
});

describe("agent status refresh", () => {
  const agentsWith = (auth: "signed_out" | "signed_in") => [
    {
      id: "claude",
      label: "Claude Code",
      installed: true,
      auth,
      signInHint: "claude auth login",
    },
  ];

  it("re-reads the agents when the window regains focus, so a finished sign-in shows up", async () => {
    const api = fakeApi();
    api.agents
      .mockResolvedValueOnce(agentsWith("signed_out"))
      .mockResolvedValue(agentsWith("signed_in"));
    await renderClient(api);
    // The agent list lives in Settings, under Agents.
    await userEvent.keyboard("{Control>},{/Control}");
    await userEvent.click(await screen.findByRole("tab", { name: "Agents" }));
    expect(await screen.findByText("Sign-in needed")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    expect(screen.queryByText("Sign-in needed")).not.toBeInTheDocument();
  });

  it("Ctrl+, opens Settings, Escape closes them, and choosing a chat leaves them", async () => {
    const api = fakeApi();
    await renderClient(api);
    await userEvent.keyboard("{Control>},{/Control}");
    expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();
    await waitFor(() => expect(api.settings).toHaveBeenCalled());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>},{/Control}");
    // The chat sidebar steps aside while Settings are open.
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument();
  });

  it("shows the context figures only once the session has started", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    await renderClient();
    socket().open();
    expect(screen.queryByRole("button", { name: /Bağlam penceresi/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Bağlam")).not.toBeInTheDocument();
    socket().receive(event(1, "s1", { type: "user_message", text: "Hello" }));
    expect(await screen.findByRole("button", { name: /Bağlam penceresi/ })).toBeInTheDocument();
  });

  it("the plugins button opens the plugins page, and choosing a chat or New chat leaves it", async () => {
    const api = fakeApi();
    await renderClient(api);
    await userEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(await screen.findByRole("region", { name: "Plugins" })).toBeInTheDocument();
    await waitFor(() => expect(api.plugins).toHaveBeenCalled());
    // The chat sidebar steps aside while the page is open.
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.queryByRole("region", { name: "Plugins" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument();
  });

  it("pressing New chat on the new-chat screen leaves it as it is", async () => {
    const api = fakeApi();
    await renderClient(api);
    socket().open();
    await userEvent.type(box(), "half a thought");
    const before = api.agents.mock.calls.length;
    await userEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]!);
    expect(api.agents.mock.calls.length).toBe(before);
    expect(box()).toHaveValue("half a thought");
  });

  it("re-reads the agents when leaving a chat for a new one", async () => {
    sessionStorage.setItem("somecode.activeSession", "s1");
    const api = fakeApi();
    await renderClient(api);
    const before = api.agents.mock.calls.length;
    await userEvent
      .setup()
      .click(screen.getAllByRole("button", { name: "New chat" })[0]!);
    await waitFor(() =>
      expect(api.agents.mock.calls.length).toBeGreaterThan(before),
    );
  });
});
