# YAWF Stream website

The cinematic marketing site for YAWF Stream.

## Local development

```sh
npm ci
npm run dev
```

The production build is mounted at `/debridstreamer/` while tgk30.com hosts the site. The Vite base path and React router basename must stay aligned.

## Validation

```sh
npm run build
cd ..
node scripts/check_website_app.mjs
node scripts/check_website_path_mount.mjs
```

## Deployment

Use `scripts/deploy_website_cloudflare.mjs` from the repository root. It builds and validates this project before publishing the static output through Cloudflare Pages and the mounted-path Worker.
