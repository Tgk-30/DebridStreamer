// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AmbientVideo } from "./AmbientVideo";

describe("AmbientVideo", () => {
  it("renders a decorative, muted, looping autoplay video for the named loop", () => {
    const { container } = render(<AmbientVideo name="aurora" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe("/videos/aurora.mp4");
    expect(video).toHaveClass("ambient-video");
    expect(video).toHaveAttribute("aria-hidden", "true");
    expect(video).toHaveAttribute("tabindex", "-1");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
  });

  it("applies the default opacity and a custom class", () => {
    const { container } = render(
      <AmbientVideo name="cinema" className="extra" />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toHaveClass("ambient-video", "extra");
    expect(video.style.opacity).toBe("0.35");
    expect(video.getAttribute("src")).toBe("/videos/cinema.mp4");
  });

  it("honours an explicit opacity override", () => {
    const { container } = render(<AmbientVideo name="secure" opacity={0.8} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.style.opacity).toBe("0.8");
  });
});
