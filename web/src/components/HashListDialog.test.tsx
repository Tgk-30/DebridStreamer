// @vitest-environment jsdom
//
// Component coverage for HashListDialog — the import / export / generate(AI)
// hash-list dialog. The pure hashlist codec, the data-layer orchestration
// (import/export/aiEmit), and the AppStore are mocked so each tab's branches
// (gated-on-missing-service, paste→submit→progress→summary, export string +
// copy, AI generate + unresolved, error states, Escape/close) are exercised
// deterministically.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashListDialog } from "./HashListDialog";
import type { DebridTorrent } from "../services/debrid/models";

// --- Mocks -------------------------------------------------------------------

const importHashList = vi.fn();
const exportHashList = vi.fn();
const aiEmitHashList = vi.fn();

vi.mock("../data/hashlistActions", () => ({
  importHashList: (...a: unknown[]) => importHashList(...a),
  exportHashList: (...a: unknown[]) => exportHashList(...a),
  aiEmitHashList: (...a: unknown[]) => aiEmitHashList(...a),
}));

const parseHashListInput = vi.fn();

vi.mock("../lib/hashlist", () => ({
  parseHashListInput: (...a: unknown[]) => parseHashListInput(...a),
}));

// Store slice the dialog (+ its tabs) reads: `services`. Each test overrides it
// via this mutable holder.
let mockServices: Record<string, unknown> = {};
vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ services: mockServices }),
}));

// --- Helpers -----------------------------------------------------------------

function debridSvc(overrides: Record<string, unknown> = {}) {
  return { hasServices: true, addMagnet: vi.fn(), ...overrides };
}

function torrent(infoHash: string | null, name = "T"): DebridTorrent {
  return { infoHash, name } as unknown as DebridTorrent;
}

function setup(
  opts: {
    services?: Record<string, unknown>;
    torrents?: DebridTorrent[];
    onClose?: () => void;
    onImported?: () => void;
  } = {},
) {
  mockServices = opts.services ?? { debrid: debridSvc() };
  const onClose = opts.onClose ?? vi.fn();
  const onImported = opts.onImported ?? vi.fn();
  const utils = render(
    <HashListDialog
      torrents={opts.torrents ?? []}
      onClose={onClose}
      onImported={onImported}
    />,
  );
  return { ...utils, onClose, onImported };
}

beforeEach(() => {
  vi.clearAllMocks();
  parseHashListInput.mockReturnValue([]);
  // jsdom has no clipboard by default; provide a writable spy.
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// --- Shell / a11y ------------------------------------------------------------

describe("HashListDialog shell", () => {
  it("renders an aria-modal dialog with the three tabs", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Hash list");
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("closes when the close button is clicked", async () => {
    const onClose = vi.fn();
    setup({ onClose });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not the dialog body", async () => {
    const onClose = vi.fn();
    const { container } = setup({ onClose });
    // Clicking inside the dialog should NOT close (stopPropagation).
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // Clicking the backdrop closes.
    const backdrop = container.querySelector(".hl-backdrop") as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape (useModalA11y)", () => {
    const onClose = vi.fn();
    setup({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts on the Import tab", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Import" }).className,
    ).toContain("is-active");
  });
});

// --- Tab switching -----------------------------------------------------------

describe("tab switching", () => {
  it("switches to Export then Generate, marking the active chip", async () => {
    setup({ services: { debrid: debridSvc() }, torrents: [] });

    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      screen.getByRole("button", { name: "Export" }).className,
    ).toContain("is-active");
    // Empty library -> export empty-state note.
    expect(screen.getByText(/library is empty/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(
      screen.getByRole("button", { name: "Generate" }).className,
    ).toContain("is-active");
  });
});

// --- Import tab --------------------------------------------------------------

describe("Import tab", () => {
  it("gates when no debrid service is configured", () => {
    setup({ services: { debrid: null } });
    expect(
      screen.getByText(/Configure a debrid service in Settings/i),
    ).toBeInTheDocument();
    // No textarea in the gated state.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("gates when debrid present but hasServices is false", () => {
    setup({ services: { debrid: debridSvc({ hasServices: false }) } });
    expect(
      screen.getByText(/Configure a debrid service in Settings/i),
    ).toBeInTheDocument();
  });

  it("shows the no-hashes hint and a disabled add button when input parses empty", () => {
    parseHashListInput.mockReturnValue([]);
    setup();
    expect(screen.getByText("No valid hashes detected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to debrid" }),
    ).toBeDisabled();
  });

  it("reports the detected hash count (singular + plural) as the user types", async () => {
    setup();
    const textarea = screen.getByRole("textbox");

    parseHashListInput.mockReturnValue([{ infoHash: "a".repeat(40) }]);
    await userEvent.type(textarea, "x");
    expect(screen.getByText("1 hash detected")).toBeInTheDocument();

    parseHashListInput.mockReturnValue([
      { infoHash: "a".repeat(40) },
      { infoHash: "b".repeat(40) },
    ]);
    await userEvent.type(textarea, "y");
    expect(screen.getByText("2 hashes detected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to debrid" }),
    ).toBeEnabled();
  });

  it("runs the import, drives progress, shows the summary, and calls onImported", async () => {
    const entries = [{ infoHash: "a".repeat(40) }, { infoHash: "b".repeat(40) }];
    parseHashListInput.mockReturnValue(entries);

    let resolveImport!: (v: unknown) => void;
    importHashList.mockImplementation((_entries, _debrid, onProgress) => {
      // Emit a mid-flight progress tick so the button label updates.
      onProgress(1, 2);
      return new Promise((res) => {
        resolveImport = res;
      });
    });

    const onImported = vi.fn();
    const debrid = debridSvc();
    setup({ services: { debrid }, onImported });

    const addBtn = screen.getByRole("button", { name: /Add to debrid/i });
    await userEvent.click(addBtn);

    // Progress label reflects the onProgress(1,2) tick and button is disabled.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Adding 1/2…" }),
      ).toBeDisabled(),
    );
    expect(importHashList).toHaveBeenCalledWith(
      entries,
      debrid,
      expect.any(Function),
    );

    resolveImport({ total: 2, succeeded: 2, failed: 0, results: [] });

    await waitFor(() =>
      expect(screen.getByText(/Added\s*2\s*of\s*2\./i)).toBeInTheDocument(),
    );
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("shows failed count in the summary and does not call onImported when nothing succeeded", async () => {
    parseHashListInput.mockReturnValue([{ infoHash: "a".repeat(40) }]);
    importHashList.mockResolvedValue({
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [],
    });
    const onImported = vi.fn();
    setup({ onImported });

    await userEvent.click(screen.getByRole("button", { name: /Add to debrid/i }));

    await waitFor(() =>
      expect(screen.getByText(/Added\s*0\s*of\s*1\./i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/1 failed\./i)).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("surfaces an Error message when the import throws", async () => {
    parseHashListInput.mockReturnValue([{ infoHash: "a".repeat(40) }]);
    importHashList.mockRejectedValue(new Error("boom"));
    setup();

    await userEvent.click(screen.getByRole("button", { name: /Add to debrid/i }));
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("stringifies a non-Error throw", async () => {
    parseHashListInput.mockReturnValue([{ infoHash: "a".repeat(40) }]);
    importHashList.mockRejectedValue("plain string");
    setup();

    await userEvent.click(screen.getByRole("button", { name: /Add to debrid/i }));
    await waitFor(() =>
      expect(screen.getByText("plain string")).toBeInTheDocument(),
    );
  });

  it("does nothing on run() when there are no parsed entries (guard)", async () => {
    parseHashListInput.mockReturnValue([]);
    setup();
    // Button is disabled, so importHashList must never be invoked.
    const addBtn = screen.getByRole("button", { name: "Add to debrid" });
    expect(addBtn).toBeDisabled();
    await userEvent.click(addBtn);
    expect(importHashList).not.toHaveBeenCalled();
  });
});

// --- Export tab --------------------------------------------------------------

describe("Export tab", () => {
  async function gotoExport(torrents: DebridTorrent[]) {
    setup({ services: { debrid: debridSvc() }, torrents });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
  }

  it("shows the empty-library note when there are no torrents", async () => {
    await gotoExport([]);
    expect(screen.getByText(/library is empty/i)).toBeInTheDocument();
  });

  it("counts only torrents with an infoHash (plural) in the share copy", async () => {
    await gotoExport([
      torrent("a".repeat(40)),
      torrent("b".repeat(40)),
      torrent(null),
    ]);
    // 2 of the 3 have an infoHash.
    expect(screen.getByText(/Share the\s*2\s*torrents/i)).toBeInTheDocument();
  });

  it("uses the singular form for a single hashed torrent", async () => {
    await gotoExport([torrent("a".repeat(40))]);
    expect(screen.getByText(/Share the\s*1\s*torrent\b/i)).toBeInTheDocument();
  });

  it("generates the shareable string then copies it to the clipboard", async () => {
    const encoded = "dshl1:ENCODED";
    exportHashList.mockReturnValue(encoded);
    const torrents = [torrent("a".repeat(40))];
    await gotoExport(torrents);

    await userEvent.click(
      screen.getByRole("button", { name: /Generate shareable string/i }),
    );

    expect(exportHashList).toHaveBeenCalledWith(torrents);
    const out = screen.getByDisplayValue(encoded) as HTMLTextAreaElement;
    expect(out).toHaveAttribute("readonly");
    expect(
      screen.getByText(`${encoded.length} characters`),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Copy$/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(encoded);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copied/i })).toBeInTheDocument(),
    );
  });

  it("leaves the button on Copy when the clipboard write fails", async () => {
    exportHashList.mockReturnValue("dshl1:X");
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("denied"),
    );
    await gotoExport([torrent("a".repeat(40))]);

    await userEvent.click(
      screen.getByRole("button", { name: /Generate shareable string/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Copy$/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    // Still "Copy", never flipped to "Copied".
    expect(screen.getByRole("button", { name: /^Copy$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copied/i })).not.toBeInTheDocument();
  });
});

// --- Generate (AI) tab -------------------------------------------------------

describe("Generate tab", () => {
  async function gotoGenerate(services: Record<string, unknown>) {
    setup({ services });
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
  }

  it("gates when no AI provider is configured", async () => {
    await gotoGenerate({ debrid: debridSvc(), ai: null });
    expect(
      screen.getByText(/Configure an AI provider in Settings/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Describe the list to generate"),
    ).not.toBeInTheDocument();
  });

  it("keeps Generate disabled until a non-empty prompt is entered", async () => {
    await gotoGenerate({ ai: {}, debrid: debridSvc() });
    // Two "Generate" buttons exist (tab + action); grab the action one (btn class).
    const actionBtn = screen
      .getAllByRole("button", { name: "Generate" })
      .find((b) => b.className.includes("btn-prominent"))!;
    expect(actionBtn).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText("Describe the list to generate"),
      "90s sci-fi",
    );
    expect(actionBtn).toBeEnabled();
  });

  it("emits a hash list, shows the encoded string + unresolved titles, and copies", async () => {
    aiEmitHashList.mockResolvedValue({
      entries: [],
      encoded: "dshl1:AIGEN",
      unresolved: ["Obscure Film", "Lost Title"],
    });
    const ai = { id: "ai" };
    const tmdb = { id: "tmdb" };
    const indexers = { id: "ix" };
    const debrid = debridSvc();
    await gotoGenerate({ ai, tmdb, indexers, debrid });

    await userEvent.type(
      screen.getByLabelText("Describe the list to generate"),
      "essential 90s sci-fi",
    );
    const actionBtn = screen
      .getAllByRole("button", { name: "Generate" })
      .find((b) => b.className.includes("btn-prominent"))!;
    await userEvent.click(actionBtn);

    await waitFor(() =>
      expect(screen.getByDisplayValue("dshl1:AIGEN")).toBeInTheDocument(),
    );
    expect(aiEmitHashList).toHaveBeenCalledWith("essential 90s sci-fi", 8, {
      ai,
      tmdb,
      indexers,
      debrid,
    });
    expect(
      screen.getByText(/Could not resolve:\s*Obscure Film, Lost Title/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Copy$/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("dshl1:AIGEN");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copied/i })).toBeInTheDocument(),
    );
  });

  it("does not render the unresolved note when every title resolved", async () => {
    aiEmitHashList.mockResolvedValue({
      entries: [],
      encoded: "dshl1:CLEAN",
      unresolved: [],
    });
    await gotoGenerate({ ai: {}, tmdb: null, indexers: {}, debrid: null });
    await userEvent.type(
      screen.getByLabelText("Describe the list to generate"),
      "comedies",
    );
    const actionBtn = screen
      .getAllByRole("button", { name: "Generate" })
      .find((b) => b.className.includes("btn-prominent"))!;
    await userEvent.click(actionBtn);

    await waitFor(() =>
      expect(screen.getByDisplayValue("dshl1:CLEAN")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Could not resolve/i)).not.toBeInTheDocument();
  });

  it("submits on Enter in the prompt input", async () => {
    aiEmitHashList.mockResolvedValue({
      entries: [],
      encoded: "dshl1:ENTER",
      unresolved: [],
    });
    await gotoGenerate({ ai: {}, indexers: {}, debrid: null, tmdb: null });
    const input = screen.getByLabelText("Describe the list to generate");
    await userEvent.type(input, "horror{Enter}");
    await waitFor(() => expect(aiEmitHashList).toHaveBeenCalledTimes(1));
    expect(aiEmitHashList).toHaveBeenCalledWith("horror", 8, expect.any(Object));
  });

  it("clamps the count input between 1 and 20", async () => {
    aiEmitHashList.mockResolvedValue({ entries: [], encoded: "x", unresolved: [] });
    await gotoGenerate({ ai: {}, indexers: {}, debrid: null, tmdb: null });
    const count = screen.getByRole("spinbutton") as HTMLInputElement;

    fireEvent.change(count, { target: { value: "50" } });
    expect(count.value).toBe("20");

    fireEvent.change(count, { target: { value: "0" } });
    expect(count.value).toBe("1");

    fireEvent.change(count, { target: { value: "5" } });
    expect(count.value).toBe("5");

    // The clamped count flows into the action call.
    await userEvent.type(
      screen.getByLabelText("Describe the list to generate"),
      "thrillers",
    );
    const actionBtn = screen
      .getAllByRole("button", { name: "Generate" })
      .find((b) => b.className.includes("btn-prominent"))!;
    await userEvent.click(actionBtn);
    await waitFor(() =>
      expect(aiEmitHashList).toHaveBeenCalledWith("thrillers", 5, expect.any(Object)),
    );
  });

  it("shows the working spinner while the AI request is in flight", async () => {
    let resolveAI!: (v: unknown) => void;
    aiEmitHashList.mockImplementation(
      () =>
        new Promise((res) => {
          resolveAI = res;
        }),
    );
    await gotoGenerate({ ai: {}, indexers: {}, debrid: null, tmdb: null });
    await userEvent.type(
      screen.getByLabelText("Describe the list to generate"),
      "noir",
    );
    const actionBtn = screen
      .getAllByRole("button", { name: "Generate" })
      .find((b) => b.className.includes("btn-prominent"))!;
    await userEvent.click(actionBtn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Working…/i })).toBeDisabled(),
    );
    resolveAI({ entries: [], encoded: "dshl1:DONE", unresolved: [] });
    await waitFor(() =>
      expect(screen.getByDisplayValue("dshl1:DONE")).toBeInTheDocument(),
    );
  });

  it("surfaces an Error message when generation throws", async () => {
    aiEmitHashList.mockRejectedValue(new Error("no indexers"));
    await gotoGenerate({ ai: {}, indexers: {}, debrid: null, tmdb: null });
    await userEvent.type(
      screen.getByLabelText("Describe the list to generate"),
      "westerns",
    );
    const actionBtn = screen
      .getAllByRole("button", { name: "Generate" })
      .find((b) => b.className.includes("btn-prominent"))!;
    await userEvent.click(actionBtn);
    await waitFor(() =>
      expect(screen.getByText("no indexers")).toBeInTheDocument(),
    );
  });

  it("stringifies a non-Error throw from generation", async () => {
    aiEmitHashList.mockRejectedValue("ai-string-error");
    await gotoGenerate({ ai: {}, indexers: {}, debrid: null, tmdb: null });
    await userEvent.type(
      screen.getByLabelText("Describe the list to generate"),
      "musicals",
    );
    const actionBtn = screen
      .getAllByRole("button", { name: "Generate" })
      .find((b) => b.className.includes("btn-prominent"))!;
    await userEvent.click(actionBtn);
    await waitFor(() =>
      expect(screen.getByText("ai-string-error")).toBeInTheDocument(),
    );
  });

  it("does nothing when the prompt is only whitespace (guard)", async () => {
    await gotoGenerate({ ai: {}, indexers: {}, debrid: null, tmdb: null });
    const input = screen.getByLabelText("Describe the list to generate");
    await userEvent.type(input, "   {Enter}");
    expect(aiEmitHashList).not.toHaveBeenCalled();
  });
});
