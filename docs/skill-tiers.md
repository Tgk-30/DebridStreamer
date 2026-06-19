# Skill Tiers & Progressive Disclosure

DebridStreamer hides complexity until you ask for it. There is **one app**, not
a separate "easy" and "pro" build. What you see is controlled by two things:

1. A **first-run setup** that asks how you want to use the app and picks sensible
   defaults.
2. A **Simple / Advanced** experience toggle you can flip any time.

The goal: new users get a clean, watch-now experience; power users can reveal
every dial.

---

## First-run setup (the persona picker)

The first time you open the app on a device, you are asked:

> **How do you want to use DebridStreamer?**

You pick one of four paths. Each one sets the right defaults — including whether
you start in Simple or Advanced mode.

| Choice | What it does | Starts in |
| --- | --- | --- |
| **Just watch on this device** | Start watching immediately. Everything stays on this device — no account, no setup. You can connect a server later. | Simple |
| **Connect to a server** | You already have a DebridStreamer server (or an invite link). Paste the address and sign in. | (server decides) |
| **Host for my family** | Run a server on this computer so your household can sign in from their own devices. Opens Settings → Install & setup. | Simple |
| **Advanced setup** | Jump straight into full settings — every provider, source, indexer, and appearance control. | Advanced |

There is also a **Skip for now** option that drops you in with defaults.

You can change anything later in **Settings** — the first-run choice is just a
starting point, not a lock-in.

> Note: this persona picker runs in **Local Mode** (the app on your own device).
> When you join a server, your tier is set by your profile on that server (see
> below).

---

## Simple vs Advanced

Switch any time in **Settings**, using the **Experience** toggle at the top:

- **Simple** — shows the essentials. Good for "I just want to watch."
- **Advanced** — reveals all tabs and controls: sources, updates, server admin,
  and every dial.

The hint under the toggle tells you what you'll unlock:

> *Simple shows the essentials. Switch to Advanced for sources, updates, and
> every dial.*

### What each tier shows

**Navigation (the side rail / bottom bar):**

| Destination | Simple | Advanced |
| --- | --- | --- |
| Discover, Search, Library, Watchlist, History, Settings | Shown | Shown |
| **Assistant** (AI) | Hidden | Shown |
| **Calendar** (upcoming releases) | Hidden | Shown |
| **Debrid** (debrid file library) | Hidden | Shown* |

\* *Debrid Library is a desktop-only screen and is always hidden in Server
Mode, regardless of tier.*

**Settings tabs:**

| Tab | Simple | Advanced |
| --- | --- | --- |
| Appearance | Shown | Shown |
| Playback | Shown | Shown |
| Install & setup | Shown | Shown |
| API keys | Shown | Shown |
| Providers (debrid) | Shown | Shown |
| **Updates** | Hidden | Shown |
| **Sources** (indexers) | Hidden | Shown |
| **Server** (admin) | Hidden | Shown** |

\** *The Server tab only appears in Server Mode at all — it is hidden in Local
Mode even in Advanced.*

**Settings never hides**, because it hosts the Simple/Advanced toggle itself. If
you flip back to Simple while on a now-hidden tab, the app returns you to a
visible tab automatically.

---

## How to switch tiers

- **On your own device (Local Mode):** Settings → **Experience** → choose Simple
  or Advanced. The choice is saved to this device.
- **On a server (Server Mode):** Settings → **Experience**. Your choice is saved
  to **your profile** on the server, so it follows you across the devices you
  sign in from.

---

## Quick reference

- Don't see a feature you expected? You're probably in **Simple** mode — flip to
  **Advanced** in Settings.
- The **Debrid Library** screen is desktop-only; it never appears on a hosted
  server.
- Your first-run persona only sets defaults — nothing is permanent.
