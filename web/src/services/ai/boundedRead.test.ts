// Regression for the codex finding: an untrusted AI provider could OOM the
// renderer with a multi-MB body before the parser's content cap. boundedReadText
// caps the bytes read from the response stream.

import { describe, expect, it, vi } from "vitest";
import { boundedReadText, resolveFetch } from "./types";

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

  it("caps exactly at maxBytes even when a chunk straddles the boundary", async () => {
    // Ten 1KB chunks = 10KB total, cap at 2KB. The crossing chunk is sliced, so
    // the result is EXACTLY 2KB - never over-allocated past the ceiling.
    const chunks = Array.from({ length: 10 }, () => chunk(1000));
    const text = await boundedReadText(fakeResponse(chunks), 2000);
    expect(text.length).toBe(2000);
  });

  it("caps a single oversized chunk to maxBytes (no overshoot)", async () => {
    // One 1MB chunk, cap 2KB → sliced down to exactly the cap.
    const text = await boundedReadText(fakeResponse([chunk(1_000_000)]), 2000);
    expect(text.length).toBe(2000);
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

describe("resolveFetch bounding (the production injected-fetch path)", () => {
  it("bounds an INJECTED fetch whose response is a real stream", async () => {
    // Production threads appFetch in; resolve(injected) must still bound a huge
    // streamed body (a 5MB chunk capped to the 2MB ceiling).
    const injected = vi.fn(async () =>
      fakeResponse([chunk(5_000_000)]),
    ) as never;
    const fetchImpl = resolveFetch(injected);
    const response = await fetchImpl("https://evil.example/api");
    const text = await response.text();
    expect(text.length).toBe(2_000_000); // capped, not 5MB
  });

  it("passes a tiny non-streamed test stub through unchanged", async () => {
    const stub = vi.fn(async () => ({
      status: 200,
      text: async () => '{"ok":true}',
    })) as never;
    const fetchImpl = resolveFetch(stub);
    const response = await fetchImpl("https://api.example/x");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
  });
});
