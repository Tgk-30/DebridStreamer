#!/usr/bin/env bash
# Collect libmpv + its FULL non-system dependency tree (ffmpeg, libass, libplacebo,
# luajit, …) into an output dir, relocated so every dylib references its siblings
# via @rpath. The app is then linked against the relocated libmpv (whose id is
# @rpath/libmpv.2.dylib) and carries an rpath of @executable_path/../Frameworks
# (see build.rs), so on a clean Mac it loads these bundled copies - no Homebrew.
#
# Usage:  bundle-mpv-deps.sh <path-to-libmpv.2.dylib> <output-dir>
# CI runs this per-arch before the Tauri build, then points bundle.macOS.frameworks
# at <output-dir> and MPV_LIB_DIR at it (so the app links the relocated libmpv).
#
# Signing: dylibs are ad-hoc signed here so they load locally; CI re-signs the
# whole .app (Frameworks included) with the Developer ID during the Tauri build.
set -euo pipefail

LIBMPV="${1:?usage: bundle-mpv-deps.sh <libmpv.2.dylib> <out-dir>}"
OUT="${2:?usage: bundle-mpv-deps.sh <libmpv.2.dylib> <out-dir>}"
mkdir -p "$OUT"

# Homebrew builds its bottles with the BUILDER's macOS as the deployment target,
# so on the macos-15 CI runner libmpv + its whole dep tree carry minos 15.0. dyld
# then REFUSES to load them on macOS < 15 → the app crashes at launch for every
# user below the runner's OS (the "quits unexpectedly on an older Mac" bug). These
# libs don't actually require 15; we rewrite LC_BUILD_VERSION down to the app's own
# floor so they load everywhere. 11.0 is the Apple-Silicon floor.
MIN_OS="${MPV_MIN_MACOS:-11.0}"

realpath_f() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }
# Non-system, relocatable deps of a dylib (Homebrew arm64 or Intel prefixes).
deps_of() { otool -L "$1" | awk 'NR>1{print $1}' | grep -E '^/opt/homebrew/|^/usr/local/' || true; }

# ---- 1. BFS the transitive dependency set (by resolved real path) -------------
# Keep this bash-3.2 compatible: macOS's system bash - and the CI mac runners'
# default `/usr/bin/env bash` - is 3.2, which has no `declare -A`. Track seen
# basenames in a newline-delimited string set instead of an associative array.
LF=$'\n'
seen="$LF"
queue=("$(realpath_f "$LIBMPV")")
files=()
while [ ${#queue[@]} -gt 0 ]; do
  cur="${queue[0]}"; queue=("${queue[@]:1}")
  [ -f "$cur" ] || continue
  real="$(realpath_f "$cur")"
  name="$(basename "$real")"
  case "$seen" in *"$LF$name$LF"*) continue ;; esac
  seen="$seen$name$LF"
  files+=("$real")
  while read -r dep; do queue+=("$(realpath_f "$dep")"); done < <(deps_of "$real")
done

# ---- 2. Copy every dylib flat into OUT (writable) -----------------------------
for real in "${files[@]}"; do
  cp -fL "$real" "$OUT/$(basename "$real")"
  chmod u+w "$OUT/$(basename "$real")"
done

# ---- 3. Relocate install names: id -> @rpath/name, deps -> @rpath/dep ---------
for real in "${files[@]}"; do
  f="$OUT/$(basename "$real")"
  install_name_tool -id "@rpath/$(basename "$real")" "$f"
  while read -r dep; do
    install_name_tool -change "$dep" "@rpath/$(basename "$(realpath_f "$dep")")" "$f" 2>/dev/null || true
  done < <(deps_of "$real")
  # Lower the min-OS so dyld loads it on older macOS (see MIN_OS note above). Keep
  # the SDK field at the dylib's current value; only the minos gates loading. vtool
  # invalidates the signature → codesign runs AFTER (as does CI's Developer-ID sign).
  cur_sdk="$(otool -l "$f" | awk '/LC_BUILD_VERSION/{b=1} b&&/sdk /{print $2; exit}')"
  [ -n "$cur_sdk" ] || cur_sdk="$MIN_OS"
  if vtool -set-build-version macos "$MIN_OS" "$cur_sdk" -replace -output "$f.tmp" "$f" 2>/dev/null; then
    mv -f "$f.tmp" "$f"
  else
    rm -f "$f.tmp"
  fi
  codesign --force --sign - "$f"
done

# ---- 4. Unversioned symlink so the linker's `-lmpv` finds it (link-time only;
#         at runtime the app references @rpath/libmpv.2.dylib directly) ---------
mpv_versioned="$(basename "$(realpath_f "$LIBMPV")")"
( cd "$OUT" && ln -sf "$mpv_versioned" libmpv.dylib )

echo "bundled ${#files[@]} dylibs into $OUT (+ libmpv.dylib link)"
ls "$OUT" | sed 's/^/  /'
