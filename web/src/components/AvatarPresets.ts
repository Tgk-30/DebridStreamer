// Built-in profile avatars — self-contained SVG data URLs (a gradient + a
// centered emoji), so a user can pick a fun avatar without uploading a photo.
// No binary assets: each is an inline SVG encoded as a data: URL and stored in
// the same `userAvatar` settings string an uploaded photo uses, so every render
// site (<img src={avatar}>) shows them with zero changes.

export interface PresetAvatar {
  id: string;
  label: string;
  dataUrl: string;
}

/** A 160×160 SVG avatar: diagonal gradient + a centered emoji glyph. */
function svgAvatar(from: string, to: string, emoji: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="160" height="160" fill="url(#g)"/>` +
    `<text x="80" y="88" font-size="82" text-anchor="middle" dominant-baseline="central">${emoji}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEFS: Array<{
  id: string;
  label: string;
  from: string;
  to: string;
  emoji: string;
}> = [
  { id: "film", label: "Film", from: "#8c85fa", to: "#5b6bff", emoji: "🎬" },
  { id: "popcorn", label: "Popcorn", from: "#ffb547", to: "#ff7a59", emoji: "🍿" },
  { id: "star", label: "Star", from: "#ffd76a", to: "#f4a83f", emoji: "⭐" },
  { id: "tv", label: "Retro TV", from: "#5cd1e6", to: "#2f8bd6", emoji: "📺" },
  { id: "ghost", label: "Ghost", from: "#aab2c8", to: "#6d7690", emoji: "👻" },
  { id: "rocket", label: "Rocket", from: "#ff6fae", to: "#a24bff", emoji: "🚀" },
  { id: "cat", label: "Cat", from: "#ffa17a", to: "#d76d5a", emoji: "🐱" },
  { id: "wave", label: "Wave", from: "#4fd3a5", to: "#2f8fb0", emoji: "🌊" },
];

export const PRESET_AVATARS: PresetAvatar[] = DEFS.map((d) => ({
  id: d.id,
  label: d.label,
  dataUrl: svgAvatar(d.from, d.to, d.emoji),
}));

/** Whether a stored avatar URL is one of the built-in presets (for the ring). */
export function isPresetAvatar(url: string): boolean {
  return PRESET_AVATARS.some((p) => p.dataUrl === url);
}
