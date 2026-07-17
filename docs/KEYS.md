# Keys, builds & the three access tiers

DebridStreamer is distributed in three flavors for three audiences. This doc
explains how API keys (OMDb / TMDB / Real-Debrid / AllDebrid / Premiumize /
TorBox / …) are handled in each, the build commands, and - bluntly - what is and
isn't actually protectable.

## The one security fact everything else follows from

If a program **uses** an API key to call a service, then **whoever controls the
machine that runs the program can recover the key** - by reading process memory
(`/proc/<pid>/mem`, a debugger, `--inspect`), or simply watching the outgoing
request (the key rides in the URL/headers). Encryption can't change this: the
program must decrypt the key to use it, so anyone who can run the program can
decrypt it too. This is the same reason DRM is breakable by the device owner.

Both adversarial reviewers of this implementation (OpenAI **codex** and
**MiniMax M3**) independently confirmed this and found **no critical issues** in
the crypto. So the design below makes casual extraction very hard, and - where a
key must be *truly* unrecoverable - **does not ship the key at all**.

## The three tiers

| Tier | Who | Hosting | Keys | Protection |
| --- | --- | --- | --- | --- |
| **Family** | close, trusted | **You** host one server | All keys server-side | **Strong** - keys never distributed |
| **Friends** | semi-trusted | **They** self-host; you supply some keys | embed (AES-256-GCM at rest) **or** broker | **Broker = strong** (key never on their machine, revocable token); embed = best-effort (a determined operator can extract) |
| **Public** | untrusted | They self-host | **BYOK** - they add every key | N/A - no secrets shipped |

### Tier 1 - Family (you host) - truly secure

Run one server; family members connect to it. Keys live only on your server and
never reach any client:

- env: `DS_SERVER_OMDB_API_KEY`, `DS_SERVER_TMDB_API_KEY`, … (per provider), or
- an **encrypted server-scoped credential** in the DB (admin UI / `PUT /api/admin/credentials`).

Clients get only results (e.g. `/api/omdb/:imdbId` returns ratings, never the
key) and a boolean capability flag. Build: `DS_BUILD_PROFILE=family` (embeds
nothing). Onboarding: "Connect to the family server" → URL + sign-in.

### Tier 2 - Friends (they self-host, you provide some keys) - best-effort

You build a server with selected keys baked in, **AES-256-GCM encrypted at
rest** (scrypt-derived key, per-encryption salt+nonce, authenticated). The
plaintext never touches the build's disk or the repo. At runtime the friend's
server decrypts in memory and proxies the calls - so the friend's *users* never
see the keys, only the friend-operator could extract them (and only with effort).

```
DS_BUILD_PROFILE=friends \
DS_EMBED_PASSPHRASE='a-strong-passphrase-you-keep' \
OMDB_EMBED_KEY=… TMDB_EMBED_KEY=… REALDEBRID_EMBED_KEY=… \
ALLDEBRID_EMBED_KEY=… PREMIUMIZE_EMBED_KEY=… TORBOX_EMBED_KEY=… \
node scripts/embed_secrets.mjs        # → server/embedded-secrets.json (gitignored)
```

- **`DS_EMBED_PASSPHRASE` is required.** The build refuses to bake keys without
  it (unless you explicitly accept the weak baked default via
  `DS_EMBED_ALLOW_DEFAULT_PASSPHRASE=1`). The friend's server must be given the
  **same** passphrase at runtime to use the keys.
- **Strongest variant:** deliver the passphrase to the friend's server at runtime
  (e.g. from a tiny endpoint you control), *not* baked into the image. Then the
  blob is useless to anyone who only has the build, and you can **rotate/revoke**
  it. This is as close to "unextractable" as a self-hosted build gets.
- Precedence: a user's own key (or a profile/server credential) always overrides
  the embedded key.
- Today **OMDb** is fully wired to the embedded mechanism; TMDB/debrid embedding
  is supported by the same blob and resolver and is wired per build as needed.

#### Broker mode - the *truly* unextractable friends option (implemented)

If a friend's key must be impossible to extract, **don't ship the key** - ship a
**revocable token** and have their server forward to a broker *you* run:

- **You run the broker** (any DebridStreamer server) with the real key + a list
  of accepted tokens:
  ```
  DS_SERVER_OMDB_API_KEY=your_real_key
  DS_BROKER_TOKENS=friend-alice-tok,friend-bob-tok      # one per friend, revocable
  ```
  It exposes `GET /api/broker/omdb/:imdbId` - bearer-token auth (constant-time),
  rate-limited, returns **only ratings**, never the key.
- **The friend's server** holds the broker URL + their token, and **no OMDb key**:
  ```
  DS_OMDB_BROKER_URL=https://your-broker.example
  DS_BROKER_AUTH_TOKEN=friend-alice-tok
  ```

Now the key lives only on your broker. The friend can extract their *token* (it
only grants rate-limited rating lookups, and you revoke it by removing it from
`DS_BROKER_TOKENS`) but **never the key** - it's never on their machine. A user's
own (BYOK) key still overrides the broker. This is the strongest friends-tier
option; the embedded blob above is the convenient, best-effort one.

Reviewed by **codex** (no critical/high; constant-time token check, no auth
bypass, imdb id validated, key never returned; hardening applied: pre-auth
rate-limit, server-only key resolution, response whitelisting, cache not poisoned
by BYOK).

### Tier 3 - Public (BYOK everything)

No keys shipped. Each user adds their own (Settings → keys; in Server Mode they're
stored as encrypted per-profile credentials). Build: `DS_BUILD_PROFILE=public`
(embeds nothing). Onboarding: a guided BYOK setup wizard.

## Crypto details (what the reviewers checked)

- **AES-256-GCM** authenticated encryption; fresh 16-byte salt + 12-byte nonce
  per encryption (no reuse); auth tag verified by `decipher.final()` **before**
  any plaintext is parsed (fails closed on a wrong passphrase or tampering).
- **scrypt** KDF, `N=2¹⁶, r=8, p=1`, params stored in the blob and **validated on
  load** (rejects out-of-range `N` to prevent a swapped-blob DoS).
- Decryption failure (wrong passphrase / tamper / malformed) → the server behaves
  as if nothing was embedded and logs a **sanitized** warning (never the key).
- `server/embedded-secrets.json` is **gitignored** and `chmod 600`.

## Build matrix

| `DS_BUILD_PROFILE` | Embedded keys | Onboarding | Notes |
| --- | --- | --- | --- |
| `family` | none | connect-to-server | your server holds the keys |
| `friends` | AES-256-GCM blob (requires `DS_EMBED_PASSPHRASE`) | self-host setup, keys pre-filled | best-effort vs the operator |
| `public` | none | guided BYOK wizard | the open build |
