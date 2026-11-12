import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewChat } from "./NewChat.tsx";
import { setLanguageForTests } from "../i18n/index.ts";

beforeEach(() => setLanguageForTests("en"));
afterEach(() => setLanguageForTests(null));
const agents = [{ id: "claude", label: "Claude", installed: true }];
it("turns into the new chat at once while the session starts, and prevents a duplicate session", async () => {
  let done!: () => void;
  const start = vi.fn(
    () =>
      new Promise<void>((r) => {
        done = r;
      }),
  );
  render(
    <NewChat
      agents={agents}
      projects={[{ id: "p", name: "app", path: "/tmp/app" }]}
      onStart={start}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Fix the failing test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  fireEvent.click(screen.queryByRole("button", { name: "Send" }) ?? document.body);
  expect(start).toHaveBeenCalledExactlyOnceWith({
    agentId: "claude",
    path: "/tmp/app",
    name: "app",
    text: "Fix the failing test",
  });
  // The page already looks like the chat: the message, a "starting" line, a box that waits.
  expect(screen.getByText("Fix the failing test")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Starting session");
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await act(async () => done());
});
it("retains the draft and allows retry after a failed agent start", async () => {
  const start = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  render(
    <NewChat
      agents={agents}
      projects={[{ id: "p", name: "app", path: "/tmp/app" }]}
      onStart={start}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await act(async () => {});
  expect(start).toHaveBeenCalledTimes(2);
});

it("offers the agent's model before any session exists and sends the changed choice with the first message", async () => {
  const start = vi.fn(async () => {});
  const options = [
    { id: "model", name: "Model", category: "model", currentValue: "sonnet", choices: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
  ];
  const loadOptions = vi.fn(async () => options);
  render(
    <NewChat
      agents={agents}
      projects={[{ id: "p", name: "app", path: "/tmp/app" }]}
      onStart={start}
      loadOptions={loadOptions}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Model: Sonnet" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Opus" }));
  expect(loadOptions).toHaveBeenCalledWith("claude", "/tmp/app");
  expect(await screen.findByRole("button", { name: "Model: Opus" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Hi" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ text: "Hi", config: { model: "opus" } }));
});

it("sends nothing extra when the model was left alone or the options cannot be loaded", async () => {
  const start = vi.fn(async () => {});
  render(
    <NewChat
      agents={agents}
      projects={[{ id: "p", name: "app", path: "/tmp/app" }]}
      onStart={start}
      loadOptions={async () => {
        throw new Error("offline");
      }}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Hi" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(start).toHaveBeenCalledWith({ agentId: "claude", path: "/tmp/app", name: "app", text: "Hi" });
});

const modeOptions = [{ id: 'mode', name: 'Mode', category: 'mode', currentValue: 'default', choices: [{ value: 'default', name: 'Default' }, { value: 'deep_research', name: 'Deep research' }] }];

it('turns into a research page when Deep research is picked: research questions, platforms, depth, focus', async () => {
  const start = vi.fn().mockResolvedValue(undefined);
  const onServerSetting = vi.fn();
  render(
    <NewChat
      agents={agents}
      projects={[{ id: 'p', name: 'app', path: '/tmp/app' }]}
      onStart={start}
      loadOptions={async () => modeOptions}
      serverSettings={{ planAutoApprove: true, defaultApproval: 'ask', agentGuide: true, scoutSubagent: true, browserTool: 'local', researchEngines: ['google', 'bing'], researchDepth: 'deep' }}
      onServerSetting={onServerSetting}
    />,
  );
  expect(await screen.findByRole('heading', { level: 1, name: /app/ })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Search platforms' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /Mode/ }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: /Deep research/ }));
  // The question changes, the panel appears.
  expect(screen.queryByRole('heading', { level: 1, name: /app/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/dig into/);
  const platforms = screen.getByRole('group', { name: 'Search platforms' });
  expect(platforms.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /Yandex/ }));
  expect(onServerSetting).toHaveBeenLastCalledWith({ researchEngines: ['google', 'yandex', 'bing'] });
  fireEvent.click(screen.getByRole('radio', { name: /Exhaustive/ }));
  expect(onServerSetting).toHaveBeenLastCalledWith({ researchDepth: 'exhaustive' });
  fireEvent.click(screen.getByRole('button', { name: 'Turn it on' }));
  expect(onServerSetting).toHaveBeenLastCalledWith({ browserTool: 'any' });
  // A starting point fills the box; the focus goes into the message.
  fireEvent.click(screen.getByRole('button', { name: 'Check a claim' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Check this claim against reliable sources: ');
  fireEvent.click(screen.getByRole('button', { name: 'Academic' }));
  fireEvent.click(screen.getByRole('button', { name: 'GitHub and code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Site infrastructure' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Tables first' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Is Rust faster than Go?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ text: 'Is Rust faster than Go?\n\nSource focus: Academic, GitHub and code, Site infrastructure\nReport format: Tables first', config: { mode: 'deep_research' } }));
});
