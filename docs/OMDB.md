# OMDb ratings

DebridStreamer can enrich a title's Detail page with **IMDb / Rotten Tomatoes /
Metacritic** ratings from [OMDb](https://www.omdbapi.com/). OMDb requires an API
key. There are three ways to supply one, for three different distribution
situations.

> **The one security fact that matters:** you can never put an API key inside a
> client app such that "nobody can track it." A client that calls OMDb directly
> sends the key in the request URL (`?apikey=…`), so anyone who can watch *their
> own* network traffic recovers it — obfuscation only stops casual file
> inspection. **The only way a key genuinely cannot be extracted is to never ship
> it to the client at all** — i.e. proxy the request through a server you
> control (Mode A below). Use that for limited distribution.

## Mode A — Server "hidden key" proxy (limited distribution, truly unextractable)

The key lives **only on the self-hosted server**; the server calls OMDb and
returns just the parsed ratings. Clients never receive the key and never make the
OMDb request, so it cannot be extracted from a client or sniffed off a client's
wire. This is the right choice for a build you hand out to a limited audience.

Set it on the server one of two ways:

- **Env (simplest, baked into a server image / compose):**
  ```
  DS_SERVER_OMDB_API_KEY=your_omdb_key
  ```
- **Encrypted credential (via the admin UI / `PUT /api/admin/credentials`):** add
  a **server-scoped** `omdb` credential. It's stored AES-encrypted in the server
  DB and never returned to clients (credential reads are redacted).

The client learns only a boolean capability (`omdbProxy`) at bootstrap — never
the key — and fetches ratings via `GET /api/omdb/:imdbId`. Distribute the client
in Server Mode pointed at this server and every user gets ratings with nothing to
configure and no extractable key.

## Mode B — Bring your own key (public / personal / locally run)

Any user adds their **own** OMDb key in **Settings → OMDB**. The client calls
OMDb directly with that key. This is the right default for the public, open
build: there's no shared key to protect because each person uses their own.

- **Local Mode:** stored in the local settings store (treated as a secret).
- **Server Mode:** stored as a **profile-scoped** encrypted `omdb` credential; the
  `/api/omdb` proxy then prefers that user's key over the server's shared key, so
  "personal use" works even on a shared server — still without exposing it to the
  client.

Precedence: a user's own key always wins over the server's hidden key.

## Mode C — Embedded build-time key (serverless limited distribution, best-effort)

If you want a **no-server** client build that still ships ratings, bake a key in
at build time:

```
OMDB_EMBED_KEY=your_omdb_key npm run build       # in web/
```

`OMDB_EMBED_KEY` is **not** a `VITE_` variable, so Vite does not inline it as
plaintext. `vite.config.ts` XOR+base64-obfuscates it into the `__OMDB_EMBED__`
define, and the app deobfuscates it at runtime. The plaintext key never appears
in the JS bundle (verified: a build with a test key shows **0** plaintext hits in
`dist/`), and it is never written to the settings/localStorage the user can
export.

**But this is best-effort only.** The deobfuscation code ships alongside the
blob, and the key still goes out in the OMDb request URL — a determined user can
recover it. If "cannot be tracked by anyone" is a hard requirement, use **Mode
A**. The embedded key is also overridden by a user's own key (Mode B).

## Summary

| Mode | Where the key lives | Extractable by a user? | Use for |
| --- | --- | --- | --- |
| **A. Server proxy** | Server env / encrypted DB credential | **No** | Limited distribution |
| **B. BYOK** | The user's own settings / profile credential | It's their own key | Public / personal / local |
| **C. Embedded** | Obfuscated in the client build | Yes (network + reversible) | Serverless limited distribution (best-effort) |
