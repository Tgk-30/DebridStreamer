import type { Store } from "../../storage/types";
import {
  DownloadManager,
  type DownloadDebridResolver,
} from "./DownloadManager";

let active: {
  store: Store;
  debrid: DownloadDebridResolver | null;
  manager: DownloadManager;
} | null = null;

/** Keep exactly one native event subscription for the app process. */
export function startDownloadsRuntime(
  store: Store,
  debrid: DownloadDebridResolver | null,
): DownloadManager {
  if (active != null && active.store === store && active.debrid === debrid) {
    return active.manager;
  }
  active?.manager.stop();
  const manager = new DownloadManager(store, debrid);
  active = { store, debrid, manager };
  void manager.start();
  return manager;
}

export function stopDownloadsRuntime(manager: DownloadManager): void {
  if (active?.manager !== manager) return;
  manager.stop();
  active = null;
}
