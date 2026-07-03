// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrailerModal } from "./TrailerModal";

describe("TrailerModal", () => {
  it("embeds the youtube-nocookie player for the given key with autoplay", () => {
    render(<TrailerModal videoKey="abc123" title="Dune" onClose={() => {}} />);
    const iframe = screen.getByTitle("Dune trailer") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toContain(
      "youtube-nocookie.com/embed/abc123",
    );
    expect(iframe.getAttribute("src")).toContain("autoplay=1");
  });

  it("exposes a labelled modal dialog", () => {
    render(<TrailerModal videoKey="k" title="Heat" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /trailer: heat/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes via the close button, the backdrop, and Escape", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TrailerModal videoKey="k" title="X" onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /close trailer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector(".trailer-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("does not close when the dialog body (not the backdrop) is clicked", () => {
    const onClose = vi.fn();
    render(<TrailerModal videoKey="k" title="X" onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("percent-encodes the video key", () => {
    render(<TrailerModal videoKey="a/b?c" title="T" onClose={() => {}} />);
    const iframe = screen.getByTitle("T trailer") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toContain("embed/a%2Fb%3Fc");
  });
});
