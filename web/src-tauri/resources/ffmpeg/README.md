Generated ffmpeg and ffprobe resources are written here during desktop release prep.

Run `node scripts/download_ffmpeg.mjs <platform>` with the same platform label
used by `scripts/download_tauri_node_runtime.mjs`. Generated binaries are ignored
by git and bundled through `tauri.conf.json`.
