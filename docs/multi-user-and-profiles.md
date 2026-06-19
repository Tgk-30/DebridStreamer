# Multi-User & Profiles

A DebridStreamer server is built for a household: multiple people, each with
their own sign-in and their own private history — while sharing one set of
provider credentials and one debrid-facing IP.

This guide covers how accounts, roles, and credentials fit together.

---

## Accounts and profiles

Each person who uses the server gets an **account** with its own username and
password, paired with a **household profile** that owns their personal data.

A profile keeps these **separate per person**:

- **Watch history** and **resume points** ("Continue Watching")
- **Watchlist**
- **Library** and its **folders**
- Personal **settings** (including the Simple/Advanced experience tier)
- Sign-in **sessions / devices** (each person can review and revoke their own)
- Optional **personal credential overrides** (see below)

One person never sees another person's history, watchlist, or library.

---

## Roles

Every account has a role that controls what it can do:

| Role | Can do |
| --- | --- |
| **Owner** | The first account created at setup. Full control: manage everyone, shared credentials, admin invites, diagnostics. Cannot be disabled. |
| **Admin** | Manage profiles, invites, shared credentials, and view usage/diagnostics. (Only the **owner** can create *admin*-level accounts or invites.) |
| **Member** | A normal household user: their own history, watchlist, library, settings, and optional personal overrides. |
| **Restricted** | A more limited member role for tighter setups. |

---

## Adding people: invite links vs. created profiles

Owners and admins manage users in **Settings → Server**. Two ways to add someone:

### Invite links (recommended)

Create an invite link in **Settings → Server**. Send it to the person. When they
open it, they:

1. Land in the hosted app,
2. Create **their own password** and an isolated profile,
3. Get signed in automatically.

You never have to share or type their password, and you never hand out the shared
debrid credentials. Invites can carry a role, a default Simple/Advanced tier, an
expiry, and a maximum number of uses.

### Created profiles

An owner/admin can also create a profile directly (username + initial password +
role + default tier). Useful when you'd rather set the account up yourself.

---

## Credentials: shared server-wide vs. per-profile overrides

This is the key concept for a household.

### Shared (server) credentials — the default

The owner/admin stores credentials **once, on the server** — debrid tokens, a
TMDB key, an AI provider key, an OpenSubtitles key, etc. These are encrypted at
rest. **Every profile uses them by default**, so family members can stream, get
recommendations, and fetch subtitles **without ever seeing or entering a token.**

### Personal (profile) overrides — optional

Any user can save their **own** credential for a provider in
**Settings → Server**, without admin involvement. When a profile has its own
credential for a provider, it is used **instead of** the shared one — but only
for that profile.

The server resolves credentials in this order, per provider, per profile:

1. **This profile's own override**, if set and active → use it.
2. Otherwise the **shared server credential**, if set → use it.
3. Otherwise that feature is unavailable for this profile.

Use cases for overrides: someone wants to bring their own debrid account, their
own AI key, or their own subtitle key, while still sharing everything else.

> Users can also change their **own password** from Settings → Server, so admins
> don't have to handle every password reset.

---

## What admins can see (and not see)

Owners/admins get diagnostics in **Settings → Server**:

- **Usage:** per-profile bandwidth served by the proxy — who is using the hosted
  network path, and how much.
- **Active streams:** which profiles are streaming right now, bytes sent, HTTP
  status, and expiry.
- **Health & warnings:** session counts, configuration flags (HTTPS cookies,
  proxy trust, etc.), and recent stream errors.
- **Audit log:** auth, credential changes, profile changes, and stream starts.

Privacy notes baked into the design:

- Credential **values** are never shown back or logged — only redacted status.
- Subtitle searches log language codes and whether free text was used, but
  **not the search text** itself.

---

## A typical household setup

1. Owner completes first-run setup on the server.
2. Owner adds shared credentials once: a TMDB key + a debrid provider (and
   optionally AI + OpenSubtitles keys).
3. Owner creates an **invite link** per family member and shares it.
4. Each member opens the link, sets their own password, and starts watching —
   with their own history and watchlist, using the shared credentials, all
   egressing from the single server IP.
5. Anyone who wants to bring their own debrid/AI/subtitle account adds a
   **personal override** in Settings → Server.
