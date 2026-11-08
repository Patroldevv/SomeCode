import { act, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock.tsx";
vi.mock("../lib/highlight.ts", () => ({
  highlightTokens: async (code: string) => [
    [
      {
        text: code,
        color:
          document.documentElement.dataset["theme"] === "light"
            ? "#000000"
            : "#ffffff",
      },
    ],
  ],
}));
it("recolors existing code when the user changes theme", async () => {
  document.documentElement.dataset["theme"] = "dark";
  const { container } = render(<CodeBlock code="const value = 1" lang="ts" />);
  await waitFor(() =>
    expect(container.querySelector("code span")).toHaveStyle({
      color: "#ffffff",
    }),
  );
  act(() => {
    document.documentElement.dataset["theme"] = "light";
  });
  await waitFor(() =>
    expect(container.querySelector("code span")).toHaveStyle({
      color: "#000000",
    }),
  );
});
