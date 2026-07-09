# DebridStreamer Documentation

DebridStreamer is one app that runs three ways: a desktop app, an installable
web app (PWA), and a self-hosted server for your household. These guides cover
how to use it and how to run your own server.

## Guides

| Guide | What it covers |
| --- | --- |
| [Skill tiers & progressive disclosure](skill-tiers.md) | Simple vs Advanced mode, the first-run setup, and what each tier shows or hides. |
| [Self-hosting guide](self-hosting.md) | What the server is, where to run it, how to start it, and where your data lives. |
| [Remote access](remote-access.md) | Reaching your server from anywhere with Tailscale or Cloudflare Tunnel, plus the single-IP privacy rationale. |
| [Multi-user & profiles](multi-user-and-profiles.md) | Accounts, household profiles, shared vs personal credentials, and separate histories. |
| [Server-Mode features](server-mode-features.md) | What works when self-hosted, and the current limitations. |

## Where to start

- **Just want to watch on one device?** Open the app and pick *"Just watch on
  this device."* No server, no account. See
  [Skill tiers](skill-tiers.md).
- **Want your family to stream from their own devices?** Run a server and share
  one link. Start with the [Self-hosting guide](self-hosting.md), then
  [Remote access](remote-access.md).
- **Setting up users?** See [Multi-user & profiles](multi-user-and-profiles.md).

## Related architecture docs

These describe how the project is built (for contributors, not end users):

- [`SELF_HOSTING_DESIGN.md`](SELF_HOSTING_DESIGN.md) - design and status.
- [`DOCKER.md`](DOCKER.md) - Docker server reference.
- [`RELEASE_AND_UPDATES.md`](RELEASE_AND_UPDATES.md) - desktop OTA updates.
