import { describe, expect, it } from "vitest";
import { ListType, SyncState } from "./models";

describe("SyncState constants", () => {
  it("enumerates the state literals", () => {
    expect(SyncState.idle).toBe("idle");
    expect(SyncState.running).toBe("running");
    expect(SyncState.success).toBe("success");
    expect(SyncState.failed).toBe("failed");
  });

  it("accepts only known SyncState values", () => {
    const v: SyncState = "running";
    expect(["idle", "running", "success", "failed"]).toContain(v);
  });
});

describe("ListType helpers", () => {
  it("supports folders for favorites/custom only", () => {
    expect(ListType.supportsFolders(ListType.watchlist)).toBe(false);
    expect(ListType.supportsFolders(ListType.favorites)).toBe(true);
    expect(ListType.supportsFolders(ListType.custom)).toBe(true);
  });

  it("returns every list type in a stable order", () => {
    expect(ListType.allCases()).toEqual(["watchlist", "favorites", "custom"]);
  });
});

