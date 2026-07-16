// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { TraktTokenResponse } from "../services/sync/models";
import { TraktSyncError } from "../services/sync/types";
import type { TraktDeviceAuthService } from "./TraktConnectDialog";

const saveTraktTokens = vi.hoisted(() => vi.fn());

vi.mock("../data/traktConnection", () => ({ saveTraktTokens }));
vi.mock("./useModalA11y", () => ({ useModalA11y: () => ({ current: null }) }));
vi.mock("./Icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));

import { TraktConnectDialog } from "./TraktConnectDialog";

function token(): TraktTokenResponse {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 3600,
    tokenType: "bearer",
    scope: "public",
    createdAt: 1,
  };
}

function service(overrides: Partial<TraktDeviceAuthService> = {}): TraktDeviceAuthService {
  return {
    startDeviceAuth: vi.fn(async () => ({
      deviceCode: "device-code",
      userCode: "ABCD-EFGH",
      verificationURL: "https://trakt.tv/activate",
      expiresIn: 60,
      interval: 1,
    })),
    exchangeDeviceCode: vi.fn(async () => token()),
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  saveTraktTokens.mockReset();
  saveTraktTokens.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("TraktConnectDialog", () => {
  it("starts device auth on mount and renders the device code and URL", async () => {
    const auth = service();
    render(
      <TraktConnectDialog
        clientId="client"
        clientSecret="secret"
        onClose={() => {}}
        onConnected={() => {}}
        service={auth}
      />,
    );
    await flush();

    expect(auth.startDeviceAuth).toHaveBeenCalledWith("client");
    expect(screen.getByLabelText("Trakt device code")).toHaveTextContent("ABCD-EFGH");
    expect(screen.getByRole("link", { name: "https://trakt.tv/activate" })).toHaveAttribute(
      "href",
      "https://trakt.tv/activate",
    );
  });

  it("keeps polling after Trakt returns a pending 400", async () => {
    const exchangeDeviceCode = vi.fn(async () => {
      throw TraktSyncError.httpStatus(400, "authorization_pending");
    });
    const auth = service({ exchangeDeviceCode });
    render(
      <TraktConnectDialog
        clientId="client"
        clientSecret="secret"
        onClose={() => {}}
        onConnected={() => {}}
        service={auth}
      />,
    );
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(exchangeDeviceCode).toHaveBeenCalledTimes(2);
  });

  it("persists an approved token and closes", async () => {
    const onClose = vi.fn();
    const onConnected = vi.fn();
    const auth = service();
    render(
      <TraktConnectDialog
        clientId="client"
        clientSecret="secret"
        onClose={onClose}
        onConnected={onConnected}
        service={auth}
      />,
    );
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saveTraktTokens).toHaveBeenCalledWith(token());
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the pending poll timer on unmount", async () => {
    const exchangeDeviceCode = vi.fn(async () => token());
    const auth = service({ exchangeDeviceCode });
    const { unmount } = render(
      <TraktConnectDialog
        clientId="client"
        clientSecret="secret"
        onClose={() => {}}
        onConnected={() => {}}
        service={auth}
      />,
    );
    await flush();
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(exchangeDeviceCode).not.toHaveBeenCalled();
  });
});
