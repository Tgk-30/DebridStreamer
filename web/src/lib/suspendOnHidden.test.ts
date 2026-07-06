import { describe, expect, it } from "vitest";
import { installSuspendOnHidden } from "./suspendOnHidden";

type MockDocument = {
  documentElement: { dataset: Record<string, string> };
  hidden: boolean;
  __listeners: Array<() => void>;
  addEventListener: (name: string, listener: () => void) => void;
  removeEventListener: (name: string, listener: () => void) => void;
};

function mockDocument(): MockDocument {
  const listeners: Array<() => void> = [];
  return {
    documentElement: { dataset: {} },
    hidden: false,
    __listeners: listeners,
    addEventListener: (name: string, listener: () => void) => {
      if (name === "visibilitychange") listeners.push(listener);
    },
    removeEventListener: (name: string, listener: () => void) => {
      if (name !== "visibilitychange") return;
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    },
  };
}

function toggleVisibility(doc: MockDocument): void {
  for (const listener of doc.__listeners) {
    listener();
  }
}

describe("installSuspendOnHidden", () => {
  it("sets and clears dataset.suspended as visibility changes", () => {
    const doc = mockDocument();
    installSuspendOnHidden(doc as unknown as Document);

    expect(doc.documentElement.dataset.suspended).toBeUndefined();

    doc.hidden = true;
    toggleVisibility(doc);
    expect(doc.documentElement.dataset.suspended).toBe("");

    doc.hidden = false;
    toggleVisibility(doc);
    expect(doc.documentElement.dataset).not.toHaveProperty("suspended");
  });

  it("removes the event listener and clears the dataset on disposal", () => {
    const doc = mockDocument();
    const dispose = installSuspendOnHidden(doc as Document);
    doc.hidden = true;
    toggleVisibility(doc);
    expect(doc.documentElement.dataset.suspended).toBe("");

    dispose();
    doc.hidden = false;
    toggleVisibility(doc);
    expect(doc.documentElement.dataset).not.toHaveProperty("suspended");
    expect(doc.__listeners).toHaveLength(0);
  });
});
