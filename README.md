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

## License

AGPL-3.0-only.
