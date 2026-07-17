// Unit tests for the shared debrid JSON-coercion helpers. These pin the exact
// null-vs-value contract that the concrete services rely on - e.g. asObject([])
// and asObjectArray({}) returning null is what makes an all-miss / single-object
// provider response degrade safely rather than crash.

import { describe, expect, it } from "vitest";
import {
  asObject,
  asObjectArray,
  int64Value,
  isValidURL,
  noopSleep,
  parseJSONObject,
  parseJSONObjectArray,
} from "./jsonHelpers";

describe("int64Value", () => {
  it("passes finite numbers through", () => {
    expect(int64Value(0)).toBe(0);
    expect(int64Value(42)).toBe(42);
    expect(int64Value(-7)).toBe(-7);
  });
  it("rejects non-finite numbers", () => {
    expect(int64Value(Number.NaN)).toBeNull();
    expect(int64Value(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it("parses leading-integer strings (parseInt semantics)", () => {
    expect(int64Value("123")).toBe(123);
    expect(int64Value("12.9")).toBe(12);
    expect(int64Value("42abc")).toBe(42);
  });
  it("returns null for non-numeric strings and other types", () => {
    expect(int64Value("abc")).toBeNull();
    expect(int64Value("")).toBeNull();
    expect(int64Value(null)).toBeNull();
    expect(int64Value(undefined)).toBeNull();
    expect(int64Value(true)).toBeNull();
    expect(int64Value({})).toBeNull();
  });
});

describe("parseJSONObject", () => {
  it("parses a JSON object", () => {
    expect(parseJSONObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("returns null for empty, array, primitive, null, or invalid JSON", () => {
    expect(parseJSONObject("")).toBeNull();
    expect(parseJSONObject("[]")).toBeNull();
    expect(parseJSONObject("123")).toBeNull();
    expect(parseJSONObject("null")).toBeNull();
    expect(parseJSONObject("{not json")).toBeNull();
  });
});

describe("parseJSONObjectArray", () => {
  it("parses a JSON array", () => {
    expect(parseJSONObjectArray('[{"a":1},{"b":2}]')).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
    expect(parseJSONObjectArray("[]")).toEqual([]);
  });
  it("returns null for empty, object, or invalid JSON", () => {
    expect(parseJSONObjectArray("")).toBeNull();
    expect(parseJSONObjectArray("{}")).toBeNull();
    expect(parseJSONObjectArray("[oops")).toBeNull();
  });
});

describe("asObject", () => {
  it("returns a plain object unchanged", () => {
    const o = { x: 1 };
    expect(asObject(o)).toBe(o);
  });
  it("returns null for arrays, null, and primitives", () => {
    // An empty array → null is the exact behavior the TorBox/AllDebrid services
    // depend on for all-miss / single-object responses.
    expect(asObject([])).toBeNull();
    expect(asObject([{ a: 1 }])).toBeNull();
    expect(asObject(null)).toBeNull();
    expect(asObject(42)).toBeNull();
    expect(asObject("str")).toBeNull();
  });
});

describe("asObjectArray", () => {
  it("returns an array unchanged (including empty)", () => {
    const a = [{ x: 1 }];
    expect(asObjectArray(a)).toBe(a);
    expect(asObjectArray([])).toEqual([]);
  });
  it("returns null for non-arrays", () => {
    expect(asObjectArray({})).toBeNull();
    expect(asObjectArray(null)).toBeNull();
    expect(asObjectArray("x")).toBeNull();
  });
});

describe("isValidURL", () => {
  it("accepts absolute URLs", () => {
    expect(isValidURL("https://example.com/path")).toBe(true);
    expect(isValidURL("http://h")).toBe(true);
    expect(isValidURL("ftp://host/file")).toBe(true);
  });
  it("rejects non-URLs", () => {
    expect(isValidURL("not a url")).toBe(false);
    expect(isValidURL("")).toBe(false);
    expect(isValidURL("/relative/path")).toBe(false);
  });
});

describe("noopSleep", () => {
  it("resolves immediately without delay", async () => {
    await expect(noopSleep(1000)).resolves.toBeUndefined();
  });
});
