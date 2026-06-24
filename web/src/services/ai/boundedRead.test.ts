// Regression for the codex finding: an untrusted AI provider could OOM the
// renderer with a multi-MB body before the parser's content cap. boundedReadText
// caps the bytes read from the response stream.

import { describe, expect, it, vi } from "vitest";
import { boundedReadText } from "./types";

function chunk(n: number, fill = 120): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

/** A minimal Response-like with a streamed body and optional content-length. */
function fakeResponse(chunks: Uint8Array[], contentLength?: string): Response {
  let i = 0;
  const cancel = vi.fn(async () => {});
  return {
    headers: {
      get: (h: string) =>
        h.toLowerCase() === "content-length" ? (contentLength ?? null) : null,
    },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        cancel,
      }),
      cancel,
    },
    text: async () =>
      new TextDecoder().decode(
        chunks.reduce<Uint8Array>((acc, c) => {
          const m = new Uint8Array(acc.length + c.length);
          m.set(acc);
          m.set(c, acc.length);
          return m;
        }, new Uint8Array()),
      ),
  } as unknown as Response;
}

describe("boundedReadText", () => {
  it("reads a small body in full", async () => {
    const text = await boundedReadText(fakeResponse([chunk(100)]), 1000);
    expect(text.length).toBe(100);
  });

  it("stops reading once the cap is exceeded (no unbounded growth)", async () => {
    // Ten 1KB chunks = 10KB total, cap at 2KB → stops after crossing the cap.
    const chunks = Array.from({ length: 10 }, () => chunk(1000));
    const text = await boundedReadText(fakeResponse(chunks), 2000);
    expect(text.length).toBeLessThan(10_000); // did NOT read all 10KB
    expect(text.length).toBeLessThanOrEqual(3000); // bounded near the cap
  });

  it("rejects without reading when Content-Length exceeds the cap", async () => {
    const text = await boundedReadText(
      fakeResponse([chunk(5000)], "50000000"),
      2000,
    );
    expect(text).toBe("");
  });

  it("falls back to a sliced text() when no body stream is exposed", async () => {
    const noBody = {
      headers: { get: () => null },
      body: null,
      text: async () => "x".repeat(5000),
    } as unknown as Response;
    const text = await boundedReadText(noBody, 1000);
    expect(text.length).toBe(1000);
  });
});
