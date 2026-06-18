# DebridStreamer Website

Static download/marketing site for GitHub Pages or any static host.

It detects the visitor platform in `app.js`, reads the latest GitHub Release,
points download buttons at the best matching installer asset, and renders the
latest macOS, Windows, and Linux release assets with file sizes. If release API
loading fails, buttons fall back to the latest release page.

## Local Preview

```sh
cd website
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
