# DebridStreamer Server

Self-hosted Server Mode foundation for DebridStreamer.

## What Exists Now

- First-run owner setup.
- Cookie sessions with CSRF-protected mutations.
- Current-user session listing and revocation.
- In-memory abuse limits for login/setup/invite and stream-session mutations.
- Admin health diagnostics for sessions, streams, credentials, invites, and
  deployment flags.
- Admin active-stream dashboard data with profile, bytes, status, and expiry.
- User/profile creation.
- Profile-scoped watchlist and watch history.
- Encrypted server credentials and profile credential overrides.
- Redacted effective credential lookup.
- Short-lived protected stream sessions.
- Range-capable stream proxy.

The React client can connect through Server Mode using the same-origin hosted
PWA or `VITE_DEBRIDSTREAMER_SERVER_URL` during development.

## Run Locally

```sh
cd server
npm install
npm run dev
```

The server listens on `0.0.0.0:43110` by default.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `43110` | HTTP port |
| `HOST` | `0.0.0.0` | Bind host |
| `DS_SERVER_DATA_DIR` | `./data` | Data directory |
| `DS_SERVER_DB_PATH` | `./data/debridstreamer.sqlite` | SQLite database path |
| `DS_SERVER_SECRET_KEY` | generated in `server.key` | Secret encryption key |
| `DS_SERVER_COOKIE_SECURE` | production only | Secure cookie flag |
| `DS_SERVER_SESSION_TTL_SECONDS` | 30 days | Session lifetime |
| `DS_SERVER_ALLOW_RAW_STREAM_URLS` | non-production only | Enable raw upstream stream-session endpoint |
| `DS_SERVER_TRUST_PROXY` | `false` | Trust reverse proxy headers |
| `DS_SERVER_CORS_ORIGIN` | localhost dev only | Comma-separated browser origins allowed to call the API with cookies |

For local web development against the server:

```sh
cd server
npm run dev

cd ../web
VITE_DEBRIDSTREAMER_SERVER_URL=http://localhost:43110 npm run dev
```

## Verify

```sh
npm run typecheck
npm test
npm run build
```

Node currently prints an ExperimentalWarning for built-in `node:sqlite`.
