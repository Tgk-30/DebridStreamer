import { describe, expect, it } from "vitest";
import {
  decodeTokenResponse,
  decodeWatchlistPushResult,
} from "./types";

describe("sync/types additional decoders", () => {
  it("maps token fields", () => {
    const decoded = decodeTokenResponse({
      access_token: "a",
      refresh_token: "r",
      expires_in: 1,
      token_type: "bearer",
      scope: "public",
      created_at: 123,
    });

    expect(decoded).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 1,
      tokenType: "bearer",
      scope: "public",
      createdAt: 123,
    });
  });

  it("throws decodingFailed for a non-object push result", () => {
    expect(() => decodeWatchlistPushResult(null)).toThrow(
      "Expected object for TraktWatchlistPushResult",
    );
  });
});
