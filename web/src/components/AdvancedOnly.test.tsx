// @vitest-environment jsdom
//
// Tests the Advanced-only control gate used for control-level feature gating in
// Local and Server modes.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdvancedOnly } from "./AdvancedOnly";

const useSimpleMode = vi.fn(() => false);
vi.mock("../store/AppStore", () => ({
  useSimpleMode: () => useSimpleMode(),
}));

describe("AdvancedOnly", () => {
  it("renders children in advanced mode", () => {
    useSimpleMode.mockReturnValue(false);
    render(
      <AdvancedOnly>
        <span>Advanced control</span>
      </AdvancedOnly>,
    );
    expect(screen.getByText("Advanced control")).toBeInTheDocument();
  });

  it("hides children in simple mode", () => {
    useSimpleMode.mockReturnValue(true);
    const { container } = render(
      <AdvancedOnly>
        <span>Simple hidden control</span>
      </AdvancedOnly>,
    );
    expect(screen.queryByText("Simple hidden control")).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

