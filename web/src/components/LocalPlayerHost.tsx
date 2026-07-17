// App-wide host for completed local downloads. Detail owns stream-specific
// metadata and resume bookkeeping; this host intentionally starts a downloaded
// file at 0 and does not try to auto-advance a series pack.

import { lazy, Suspense } from "react";
import { useAppStore } from "../store/AppStore";
import { Spinner } from "./Spinner";

const VideoPlayer = lazy(() =>
  import("./VideoPlayer").then((m) => ({ default: m.VideoPlayer })),
);

function fileNameFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop();
  return name != null && name.length > 0 ? name : path;
}

/** Mounts the same native-mpv player used by Detail, but passes the completed
 * download's raw filesystem path straight to mpv instead of a webview URL. */
export function LocalPlayerHost() {
  const { localFilePlayer, closeLocalFilePlayer, settings } = useAppStore();
  if (localFilePlayer == null) return null;

  return (
    <Suspense fallback={<Spinner variant="overlay" label="Loading player…" />}>
      <VideoPlayer
        url={localFilePlayer.path}
        title={localFilePlayer.title}
        sourceFileName={fileNameFromPath(localFilePlayer.path)}
        engine="native-mpv"
        preferredPlayer={settings.preferredExternalPlayer}
        useBuiltInPlayer={settings.builtInPlayer}
        startPositionSeconds={0}
        onClose={closeLocalFilePlayer}
      />
    </Suspense>
  );
}
