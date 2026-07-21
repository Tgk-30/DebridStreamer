# Frontend performance budgets

Production builds fail when the YAWF Stream app or website exceeds the checked
limits below. The budgets use both uncompressed bytes, which constrain parse and
compile work, and level-9 gzip bytes, which approximate transferred payload.

| Surface | Initial raw | Initial gzip | Initial local requests | Largest JS raw | Largest JS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| App | 760 KiB | 220 KiB | 12 | 550 KiB | 175 KiB |
| Website | 780 KiB | 235 KiB | 3 | 960 KiB | 265 KiB |

The initial payload contains local JavaScript and CSS referenced directly by
`dist/index.html`, including module preloads. The largest-JavaScript limits apply
to every emitted JavaScript chunk and therefore bound lazy route and player
payloads as well as the entry point. Images and video previews are deliberately
excluded because their loading policy and responsive variants need separate
media-specific budgets.

The baselines recorded on 2026-07-21 are:

| Surface | Initial raw | Initial gzip | Initial local requests | Largest JS raw | Largest JS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| App | 692.6 KiB | 198.4 KiB | 10 | 496.9 KiB | 151.3 KiB |
| Website | 708.9 KiB | 213.3 KiB | 2 | 869.9 KiB | 232.2 KiB |

Run the normal production builds to enforce the budgets:

```sh
npm --prefix web run build
npm --prefix website-app run build
```

For an already-built tree, run:

```sh
node scripts/check_bundle_budgets.mjs web website-app
```

The verifier is covered by `node --test scripts/check_bundle_budgets.test.mjs`
and is exercised by CI before the production builds. Do not raise a limit only
to make a regression pass. First remove unnecessary eager imports, split the
affected route or dependency, or reduce the payload. Any deliberate budget
change should include before-and-after measurements and a product reason.
