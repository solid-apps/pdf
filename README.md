# PDF · Solid

A minimal Solid PDF reader. Browse PDFs in your pod, open them in a canvas viewer with page nav, zoom, and fullscreen.

- ~250 LOC of vanilla JS — no build step.
- [PDF.js](https://mozilla.github.io/pdf.js/) (Mozilla) for rendering, loaded from jsDelivr.
- [xlogin](https://github.com/melvincarvalho/xlogin) for Solid / Nostr authentication.

## Run

Open `index.html` from any HTTP server. There is no build step.

Or push it to a Solid pod that accepts git pushes (e.g. [jspod](https://github.com/JavaScriptSolidServer/jspod)):

```bash
git remote add pod http://localhost:5444/public/apps/pdf
git push pod HEAD:gh-pages
# then open: http://localhost:5444/public/apps/pdf/
```

## What it does

After sign-in (via the xlogin button), the sidebar discovers your storage and lists every container + `.pdf` file under `/public/` (falling back gracefully if your storage root is shadowed by a static index). Click a folder to navigate, click a PDF to render.

## Features

- LDP-aware container browser, folder-first sorting, breadcrumb navigation
- Canvas-based PDF viewer (PDF.js), DPI-aware rendering, page navigation
- Fit-page default scale (whole page visible, no scroll), zoom +/−, fit button
- Fullscreen mode (toolbar button or **F** key)
- Keyboard navigation: **←/→** or **PageUp/PageDown** to flip pages

## Solid-native features

The pod isn't just a file store — it's a real-time state bus. Two layers built on tiny JSON-LD docs:

### Remote control

Viewer writes its `{pdfUrl, page}` to `/public/pdf/state.jsonld` on every page change and subscribes to that doc via JSS's legacy WebSocket (`updates-via` header). Anything else that PUTs the doc — a phone, another tab, `curl`, the bundled CLI — drives the viewer in real time.

```bash
# Flip pages on the live viewer from any terminal:
cli/pdf-remote next
cli/pdf-remote prev
cli/pdf-remote page 12
cli/pdf-remote get      # print the current state
```

Override the target pod with `PDF_STATE=https://your.pod/public/pdf/state.jsonld cli/pdf-remote next`.

The state doc gets a public read+write ACL on first viewer load (no extra setup; you can rewrite it with stricter ACL anytime — owner-control is preserved).

### Per-PDF resume

The viewer also writes a sibling `<pdfUrl>.state.jsonld` next to each PDF. On open, it reads this doc and jumps to the last-read page. Owner-write, public-read inherited from `/public/.acl` — no special ACL needed. Resume works across devices, since the state lives in your pod, not in browser localStorage.

## License

AGPL-3.0-only.
