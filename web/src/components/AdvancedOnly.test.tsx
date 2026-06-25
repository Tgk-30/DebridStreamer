// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useSimpleMode = vi.fn();
vi.mock("../store/AppStore", () => ({
  useSimpleMode: () => useSimpleMode(),
}));

import { AdvancedOnly } from "./AdvancedOnly";

describe("AdvancedOnly", () => {
  it("renders children in Advanced mode (simpleMode=false)", () => {
    useSimpleMode.mockReturnValue(false);
    render(
      <AdvancedOnly>
        <span>Maximum file size</span>
      </AdvancedOnly>,
    );
    expect(screen.getByText("Maximum file size")).toBeInTheDocument();
  });

  it("renders nothing in Simple mode (simpleMode=true)", () => {
    useSimpleMode.mockReturnValue(true);
    render(
      <AdvancedOnly>
        <span>Maximum file size</span>
      </AdvancedOnly>,
    );
    expect(screen.queryByText("Maximum file size")).not.toBeInTheDocument();
  });
});
