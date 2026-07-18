/** Shared site constants - GitHub URLs, version, platform downloads. */
export const GITHUB_REPO = 'https://github.com/Tgk-30/DebridStreamer';
export const GITHUB_RELEASES = `${GITHUB_REPO}/releases`;
export const GITHUB_RELEASES_LATEST = `${GITHUB_RELEASES}/latest`;
export const GITHUB_ISSUES = `${GITHUB_REPO}/issues`;
export const GITHUB_DOCKER = `${GITHUB_REPO}/tree/main/deploy/compose`;

export const VERSION = 'v0.9.16-web';

export const DOWNLOAD_LINKS = {
  macos: GITHUB_RELEASES_LATEST,
  windows: GITHUB_RELEASES_LATEST,
  linux: GITHUB_RELEASES_LATEST,
} as const;
