# YAWF Stream Website

Static download/marketing site for GitHub Pages or any static host.

It detects the visitor platform in `app.js`, reads the latest GitHub Release,
points download buttons at the best matching installer asset, and renders the
latest macOS, Windows, and Linux release assets with file sizes. If release API
loading fails, buttons fall back to the latest release page.

## Local Preview

```sh
cd website
node -e "const http=require('http'),fs=require('fs'),path=require('path');const root=process.cwd();http.createServer((req,res)=>{let p=new URL(req.url,'http://127.0.0.1').pathname;if(p==='/')p='/index.html';fs.createReadStream(path.join(root,p)).on('error',()=>{res.writeHead(404);res.end('not found')}).pipe(res)}).listen(8080)"
```

Then open `http://localhost:8080`.

## Media

The preview images in `website/media/` are synthetic UI mockups. Regenerate them
from the repo root with:

```sh
node scripts/generate_website_media.mjs
```

Do not replace them with screenshots that include third-party titles, posters,
or other licensed media.

## Checks

Run the website checks from the repo root after changing `website/`:

```sh
node scripts/check_website_download_logic.mjs
node scripts/check_website_static.mjs
node scripts/check_website_path_mount.mjs
```

## Cloudflare Path Deploy

To publish the site at `https://tgk30.com/debridstreamer`, use the Cloudflare
deployment helper from the repo root:

```sh
CLOUDFLARE_API_TOKEN=... node scripts/deploy_website_cloudflare.mjs
```

The token must be an API token with:

- `Account:Cloudflare Pages:Edit`
- `Account:Workers Scripts:Edit`
- `Zone:Zone:Read`
- `Zone:Workers Routes:Edit`

The helper runs the download, static-site, mounted-path, and public-repo checks,
deploys `website/` to Cloudflare Pages, uploads a small Worker, and
installs/updates the route `tgk30.com/debridstreamer*` so the existing root site
stays untouched.

If the token can see more than one account, also set `CLOUDFLARE_ACCOUNT_ID`.
If zone discovery is unavailable, set `CLOUDFLARE_ZONE_ID`. Optional overrides:

```sh
CLOUDFLARE_DOMAIN=tgk30.com
CLOUDFLARE_PATH=/debridstreamer
CLOUDFLARE_PAGES_PROJECT=debridstreamer
CLOUDFLARE_WORKER_NAME=debridstreamer-site-path
```
