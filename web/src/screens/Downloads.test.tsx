// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ services: { debrid: null }, navigate: vi.fn() }),
}));
vi.mock("../lib/tauri", () => ({ isTauri: () => false }));

import { Downloads } from "./Downloads";

describe("Downloads honest desktop gate", () => {
  it("does not show unusable queue controls in a browser", () => {
    render(<Downloads />);
    expect(screen.getByText("Open the desktop app to download")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download desktop app/i })).toBeInTheDocument();
    expect(screen.queryByText("Your download queue is empty")).not.toBeInTheDocument();
  });
});
