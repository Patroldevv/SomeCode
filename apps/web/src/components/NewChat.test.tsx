import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewChat } from "./NewChat.tsx";
import { setLanguageForTests } from "../i18n/index.ts";

beforeEach(() => setLanguageForTests("en"));
afterEach(() => setLanguageForTests(null));
const agents = [{ id: "claude", label: "Claude", installed: true }];
it("keeps the first draft while starting and prevents a duplicate session", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(start).toHaveBeenCalledExactlyOnceWith({
    agentId: "claude",
    path: "/tmp/app",
    name: "app",
    text: "Fix the failing test",
  });
  expect(screen.getByRole("status")).toHaveTextContent("Starting session");
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Fix the failing test",
  );
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
