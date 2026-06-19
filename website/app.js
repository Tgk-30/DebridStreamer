const REPO = "Tgk-30/DebridStreamer";
const releaseURL = `https://github.com/${REPO}/releases/latest`;
const apiURL = `https://api.github.com/repos/${REPO}/releases/latest`;

const platforms = {
  mac: {
    label: "macOS",
    button: "Download for macOS",
    patterns: [
      { type: "DMG", score: 120, test: /\.dmg$/i },
      { type: "PKG", score: 110, test: /\.pkg$/i },
      { type: "App archive", score: 70, test: /\.app\.tar\.gz$/i },
      { type: "macOS", score: 20, test: /(macos|darwin|apple)/i },
    ],
  },
  windows: {
    label: "Windows",
    button: "Download for Windows",
    patterns: [
      { type: "MSI", score: 120, test: /\.msi$/i },
      { type: "EXE", score: 110, test: /\.exe$/i },
      { type: "Windows", score: 20, test: /(windows|win32|win64|x64-setup)/i },
    ],
  },
  linux: {
    label: "Linux",
    button: "Download for Linux",
    patterns: [
      { type: "AppImage", score: 130, test: /\.AppImage$/i },
      { type: "Debian package", score: 120, test: /\.deb$/i },
      { type: "RPM package", score: 110, test: /\.rpm$/i },
      { type: "Linux archive", score: 60, test: /\.tar\.gz$/i },
      { type: "Linux", score: 20, test: /linux/i },
    ],
  },
};

function platformKey() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  const narrow = window.matchMedia?.("(max-width: 640px)").matches === true;
  const touch = navigator.maxTouchPoints > 1;
  if (/iphone|ipad|android|mobile/.test(ua) || narrow || touch) return "mobile";
  if (platform.includes("mac") || ua.includes("mac os")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

function labelFor(platform) {
  if (platform === "mobile") return "Install PWA";
  return platforms[platform]?.button ?? "View downloads";
}

function isInstallerAsset(asset) {
  return !/\.(sig|sha256|sha512|blockmap)$/i.test(asset.name) &&
    !/latest\.json$/i.test(asset.name);
}

function scoreAsset(asset, platform) {
  const config = platforms[platform];
  if (!config || !isInstallerAsset(asset)) return null;

  const name = asset.name ?? "";
  let best = null;
  for (const pattern of config.patterns) {
    if (pattern.test.test(name) && (best == null || pattern.score > best.score)) {
      best = { score: pattern.score, type: pattern.type };
    }
  }
  return best;
}

function platformAssets(release, platform) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets
    .map((asset) => {
      const match = scoreAsset(asset, platform);
      return match == null ? null : { ...asset, match };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
}

function bestAsset(release, platform) {
  return platformAssets(release, platform)[0] ?? null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function setLink(selector, href) {
  document.querySelectorAll(selector).forEach((node) => {
    node.setAttribute("href", href);
  });
}

function setMeta(platform, asset) {
  document.querySelectorAll(`[data-download-meta="${platform}"]`).forEach((node) => {
    node.textContent = asset
      ? `${asset.name}${formatBytes(asset.size) ? ` - ${formatBytes(asset.size)}` : ""}`
      : "Open the latest release assets";
  });
}

function renderAssets(release) {
  const container = document.querySelector("#release-assets");
  if (!container) return;

  const groups = Object.entries(platforms)
    .map(([key, config]) => ({
      key,
      label: config.label,
      assets: platformAssets(release, key).slice(0, 4),
    }))
    .filter((group) => group.assets.length > 0);

  if (groups.length === 0) {
    container.innerHTML = "";
    const link = document.createElement("a");
    link.href = releaseURL;
    link.textContent = "Open all release assets";
    container.append(link);
    return;
  }

  container.innerHTML = "";
  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "asset-group";

    const title = document.createElement("h4");
    title.textContent = group.label;
    section.append(title);

    for (const asset of group.assets) {
      const link = document.createElement("a");
      link.href = asset.browser_download_url ?? releaseURL;
      link.className = "asset-link";

      const name = document.createElement("span");
      name.textContent = asset.name;

      const meta = document.createElement("small");
      const size = formatBytes(asset.size);
      meta.textContent = [asset.match.type, size].filter(Boolean).join(" - ");

      link.append(name, meta);
      section.append(link);
    }

    container.append(section);
  }
}

function setDownloadNote(note, text) {
  note.textContent = "";
  note.append(document.createTextNode(`${text} `));
  const link = document.createElement("a");
  link.href = releaseURL;
  link.textContent = "GitHub Releases";
  note.append(link, document.createTextNode("."));
}

async function hydrateDownloads() {
  const smart = document.querySelector("#smart-download");
  const note = document.querySelector("#download-note");
  const status = document.querySelector("#release-status");
  const platform = platformKey();

  if (smart) {
    smart.textContent = labelFor(platform);
    smart.setAttribute("href", platform === "mobile" ? "#pwa" : releaseURL);
  }

  try {
    const release = await fetch(apiURL, {
      headers: { accept: "application/vnd.github+json" },
    }).then((res) => {
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      return res.json();
    });

    for (const key of ["mac", "windows", "linux"]) {
      const asset = bestAsset(release, key);
      if (asset?.browser_download_url) {
        setLink(`[data-download="${key}"]`, asset.browser_download_url);
      }
      setMeta(key, asset);
    }

    const asset = bestAsset(release, platform);
    if (smart && asset?.browser_download_url) {
      smart.setAttribute("href", asset.browser_download_url);
      smart.textContent = `${labelFor(platform)} ${release.tag_name ?? ""}`.trim();
    }
    if (note) {
      setDownloadNote(note, `Latest release: ${release.tag_name ?? "available on"}`);
    }
    if (status) {
      const published = release.published_at
        ? new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }).format(new Date(release.published_at))
        : "GitHub Releases";
      status.textContent = `${release.name ?? release.tag_name ?? "Latest release"} published ${published}.`;
    }
    renderAssets(release);
  } catch {
    if (note) {
      setDownloadNote(note, "Latest desktop downloads are available on");
    }
    if (status) {
      status.textContent = "Open GitHub Releases to see the current desktop assets.";
    }
  }
}

hydrateDownloads();
