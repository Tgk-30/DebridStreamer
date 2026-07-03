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
      { type: "App zip", score: 80, test: /\.app\.zip$/i },
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
      { type: "Linux archive", score: 60, test: /^(?!.*\.app\.tar\.gz$).*\.tar\.gz$/i },
      { type: "Linux", score: 20, test: /linux/i },
    ],
  },
};

function detectPlatform(input = {}) {
  const ua = (input.userAgent ?? navigator.userAgent).toLowerCase();
  const platform = (input.platform ?? navigator.platform).toLowerCase();
  const touch = (input.maxTouchPoints ?? navigator.maxTouchPoints ?? 0) > 1;
  // iPadOS 13+ reports a desktop "Mac OS" UA, so detect an iPad as a Mac UA that
  // ALSO has a touchscreen (real Macs report maxTouchPoints 0). A bare `touch`
  // check would instead misclassify Windows touchscreen laptops / Surface /
  // 2-in-1s (wide screen, maxTouchPoints ~10) as mobile and hide their installer.
  const isIpadOS = touch && (platform.includes("mac") || ua.includes("mac os"));
  if (/iphone|ipad|android|mobile/.test(ua) || isIpadOS) return "mobile";
  if (platform.includes("mac") || ua.includes("mac os")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

function platformKey() {
  return detectPlatform();
}

function labelFor(platform) {
  if (platform === "mobile") return "View downloads";
  return platforms[platform]?.button ?? "View downloads";
}

function isInstallerAsset(asset) {
  return !/\.(sig|sha256|sha512|blockmap)$/i.test(asset.name) &&
    !/latest\.json$/i.test(asset.name) &&
    // The headless self-host server package (debridstreamer-server_*.deb) is not
    // a desktop-app download — keep it out of the platform pickers so a Linux
    // visitor can't grab the server by mistake. It's fetched from the Ubuntu
    // guide instead.
    !/^debridstreamer-server[_-]/i.test(asset.name);
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
    smart.setAttribute("href", platform === "mobile" ? "#download" : releaseURL);
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
      setDownloadNote(note, "Latest desktop and PWA paths are available on");
    }
    if (status) {
      status.textContent = "Open GitHub Releases to see the current desktop assets.";
    }
  }
}

function initCommandCopy() {
  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.querySelector(`#${button.dataset.copyTarget}`);
      const text = target?.textContent?.trim();
      if (!text) return;

      const original = button.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select text";
      }
      window.setTimeout(() => {
        button.textContent = original;
      }, 1800);
    });
  });
}

function initMobileMenu() {
  const nav = document.querySelector("#primary-nav");
  const toggle = document.querySelector(".menu-toggle");
  if (!nav || !toggle) return;

  document.body.classList.add("menu-ready");
  toggle.hidden = false;

  function setOpen(open) {
    nav.classList.toggle("is-open", open);
    toggle.classList.toggle("is-open", open);
    document.body.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  toggle.addEventListener("click", () => {
    setOpen(!nav.classList.contains("is-open"));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 640px)").matches) setOpen(false);
    });
  });

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 640px)").matches) setOpen(false);
  });
}

function initSectionNav() {
  const links = [...document.querySelectorAll('nav a[href^="#"]')];
  const sections = links
    .map((link) => {
      const section = document.querySelector(link.getAttribute("href"));
      return section ? { id: section.id, link, section } : null;
    })
    .filter(Boolean);

  function activate(id) {
    links.forEach((link) => {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  if (!sections.length) return;

  let frame = 0;

  function updateActiveSection() {
    frame = 0;
    const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
    const probe = window.scrollY + headerHeight + Math.max(96, window.innerHeight * 0.28);
    let current = sections[0];
    for (const candidate of sections) {
      if (candidate.section.offsetTop <= probe) current = candidate;
    }
    activate(current.id);
  }

  function requestUpdate() {
    if (frame) return;
    frame = window.requestAnimationFrame(updateActiveSection);
  }

  function requestSettledUpdates() {
    requestUpdate();
    window.setTimeout(requestUpdate, 120);
    window.setTimeout(requestUpdate, 360);
    window.setTimeout(requestUpdate, 900);
  }

  updateActiveSection();
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  window.addEventListener("hashchange", requestSettledUpdates);
  requestSettledUpdates();
}

/* ── The transport: scroll progress rendered as playback on a player bar.
      Chapters (sections) become ticks on the timeline; the mono timestamp
      maps page position onto a feature-length runtime. ─────────────────── */
function initTransport() {
  const bar = document.querySelector(".transport");
  if (!bar) return;
  const fill = bar.querySelector(".transport-fill");
  const time = bar.querySelector(".transport-time");
  const ticks = [...bar.querySelectorAll(".transport-tick")];
  const RUNTIME = 148; // "02:28" — a feature-length page

  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

  function layoutTicks() {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    if (total <= 0) return;
    const headerHeight =
      document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
    for (const tick of ticks) {
      const target = document.querySelector(tick.getAttribute("href"));
      if (!target) continue;
      const top =
        target.getBoundingClientRect().top + window.scrollY - headerHeight - 24;
      const pct = Math.min(98, Math.max(2, (top / total) * 100));
      tick.style.left = `${pct}%`;
    }
  }

  let frame = 0;
  function update() {
    frame = 0;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const progress = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0;
    if (fill) fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    if (time) {
      time.textContent = `${fmt(Math.round(progress * RUNTIME))} / ${fmt(RUNTIME)}`;
    }
  }
  function request() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", () => {
    layoutTicks();
    request();
  });
  // Re-measure once images/fonts settle the document height.
  window.addEventListener("load", layoutTicks);
  window.setTimeout(layoutTicks, 800);
  layoutTicks();
  update();
}

/* One-shot scroll reveals — sections rise in as playback advances. */
function initReveals() {
  if (!("IntersectionObserver" in window)) return;
  const nodes = document.querySelectorAll(
    ".proof-strip span, .section-head, .rail-card, .picker, .split > *, .hosting-grid article, .steps article, .status-list",
  );
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
  );
  let index = 0;
  for (const node of nodes) {
    node.classList.add("reveal");
    node.style.transitionDelay = `${(index % 5) * 70}ms`;
    index += 1;
    observer.observe(node);
  }
}

/* The hero window leans toward the cursor — fine pointers only, never under
   reduced motion. Pure transform, rAF-throttled. */
function initTilt() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (window.matchMedia("(pointer: coarse)").matches) return;
  const stage = document.querySelector(".product-stage");
  const target = document.querySelector(".app-window-main");
  if (!stage || !target) return;

  let frame = 0;
  let tiltX = 0;
  let tiltY = 0;
  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    tiltY = ((event.clientX - rect.left) / rect.width - 0.5) * 4.4;
    tiltX = (0.5 - (event.clientY - rect.top) / rect.height) * 3.2;
    if (!frame) {
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        target.style.setProperty("--tilt-x", `${tiltX.toFixed(2)}deg`);
        target.style.setProperty("--tilt-y", `${tiltY.toFixed(2)}deg`);
      });
    }
  });
  stage.addEventListener("pointerleave", () => {
    target.style.setProperty("--tilt-x", "0deg");
    target.style.setProperty("--tilt-y", "0deg");
  });
}

if (typeof window !== "undefined") {
  window.DebridStreamerWebsite = {
    bestAsset,
    detectPlatform,
    isInstallerAsset,
    labelFor,
    platformAssets,
    scoreAsset,
  };
}

if (typeof window !== "undefined" && !window.__DEBRIDSTREAMER_WEBSITE_TEST__) {
  hydrateDownloads();
  initCommandCopy();
  initMobileMenu();
  initSectionNav();
  initTransport();
  initReveals();
  initTilt();
}
