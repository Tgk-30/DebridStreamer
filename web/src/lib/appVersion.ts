import { isTauri } from "./tauri";

export type AppVersionProviders = {
  isTauri: () => boolean;
  native: () => Promise<string>;
  browser: () => string;
};

const defaultProviders: AppVersionProviders = {
  isTauri,
  native: async () => {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  },
  browser: () => __APP_VERSION__,
};

/** Resolve the displayed app version for the current runtime. */
export async function getAppVersion(
  providers: AppVersionProviders = defaultProviders,
): Promise<string> {
  if (!providers.isTauri()) return providers.browser();

  try {
    return await providers.native();
  } catch {
    return providers.browser();
  }
}
