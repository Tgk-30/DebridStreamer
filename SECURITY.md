# Security Policy

## Supported Scope

This project is built for self-hosted/private deployments, not public
multi-tenant SaaS. Supported surfaces:

- Tauri desktop app
- Self-hosted Server Mode
- Hosted PWA served by Server Mode
- Docker/Compose deployments
- Release/update packaging

## Reporting A Vulnerability

Do not open a public issue for a vulnerability that exposes credentials, stream
URLs, sessions, or private media history.

Until a dedicated security contact is configured, use a private GitHub security
advisory for the repository. Include:

- affected version or commit
- deployment mode: desktop, Docker, desktop-host, PWA, or local dev
- exact impact and reproduction steps
- whether secrets, session cookies, stream URLs, or profile data are exposed

## Security Model

The accepted trust boundaries and beta risks are recorded in
[`docs/SECURITY_DECISIONS.md`](docs/SECURITY_DECISIONS.md).

- Browser/PWA auth uses httpOnly session cookies plus CSRF tokens.
- Every personal record must be profile-scoped.
- Server credentials are admin-managed and encrypted at rest.
- Profile credential overrides are encrypted and override shared credentials only
  for that profile.
- Stream sessions are short-lived, profile-owned, and hide raw unrestricted URLs
  from clients where possible.
- Desktop OTA updates rely on Tauri signed `latest.json` metadata and signed
  release artifacts.

## Deployment Guidance

- Prefer LAN, Tailscale, or Cloudflare Access/Tunnel for private sharing.
- Use HTTPS before exposing Server Mode outside a trusted private network.
- Set `DS_SERVER_COOKIE_SECURE=true` and `DS_SERVER_TRUST_PROXY=true` behind a
  trusted HTTPS reverse proxy.
- Back up the SQLite database and the same server secret key together; encrypted
  credentials cannot be restored without the key.
- Do not share logs that contain cookies, CSRF tokens, API keys, debrid tokens,
  or raw stream URLs.
