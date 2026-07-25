# MemeForge

A meme studio that runs entirely in your browser. Pick a template or drop your
own picture, stack text and stickers on it, and export a PNG or an animated GIF.
No account, no upload, no watermark — every pixel is processed on your machine.

![The bench](docs/screenshot.png)

## What it does

**Pictures**
- ~900 templates merged from [Imgflip](https://imgflip.com) and
  [Memegen](https://memegen.link), searched fuzzily (Fuse.js) so "distrated
  boyfrend" still finds it.
- A trending feed pulled live from Reddit meme subs — grab today's format
  before it goes stale.
- Drop a file, paste with `Ctrl+V`, paste an image URL, or add a second picture
  as a layer to composite two memes.
- Recent uploads come back under **Yours**.

**Type**
- Every Google font — around 1,900 families, fetched on demand and previewed in
  their own face as you scroll the list.
- Or upload a `.ttf`/`.otf`/`.woff2` of your own; it is remembered next visit.
- Six text presets (Impact, Clean, Neon, Tag, Typewriter, Quote), plus fill,
  outline, glow, caps, alignment, spacing, line height, rotation and opacity.
- Impact renders as Impact on Windows and macOS and falls back to a bundled
  Anton everywhere else, so the classic look survives Linux.

**The picture underneath**
- Brightness, contrast, saturation, hue, blur and JPEG crunch.
- Presets: Deep fry, Noir, Faded, Vapor, Cursed.
- The classic white caption bar above the image, at any height.

**Animated GIFs**
- Import a GIF, keep it playing while you position layers on top, then export a
  new animated GIF with everything burned in.

**The workshop**
- Layers panel with drag-to-restack, hide and delete.
- Undo/redo across layers *and* filters, keyboard shortcuts throughout.
- Autosave: close the tab mid-meme and it is still on the bench when you return.
- A gallery of saved memes in IndexedDB, on your device only.
- Export PNG / JPG / WebP at 1×, 2× or 4×, copy straight to the clipboard, or
  hand off to the system share sheet.
- Installable as a PWA and usable offline apart from the remote libraries.

## Running it

It is a static site with no build step. Any file server will do:

```sh
npm run dev          # http-server on :8099
# or
python3 -m http.server 8099
```

Then open <http://127.0.0.1:8099/>. Deploying means copying the folder to any
static host (GitHub Pages, Netlify, an S3 bucket).

## Tests

Two Playwright suites drive the real app in Chromium:

- `tests/smoke.mjs` stubs the meme APIs and covers the whole path — grid,
  canvas, fonts, filters, layers, undo, PNG export, GIF decode and re-encode,
  gallery, mobile layout — without depending on anyone else's uptime.
- `tests/offline.mjs` kills every off-origin request and checks the app still
  loads, says what is unreachable, and stays usable on bundled fonts.

```sh
npm install          # playwright
npm run dev &        # serve on :8099
npm test
```

Screenshots land in `tests/shots/`.

## How it is put together

```
index.html          shell and panel markup
css/app.css         design system: graphite panels, ember accent, mono readouts
js/main.js          boot, top bar, export, shortcuts, autosave
js/studio.js        the canvas: media layer, layers, filters, history, export
js/panels.js        left drawer: templates, trending, text, stickers, adjust, layers, gallery
js/inspector.js     right column: controls for whatever is selected
js/sources.js       template and trending feeds, merged and cached
js/fonts.js         font catalogue and on-demand loading
js/media.js         GIF decode and encode
js/store.js         IndexedDB and settings
sw.js               offline shell
```

The picture on the bench is drawn into an offscreen canvas, with the adjustment
filters applied, and used as the Fabric canvas background. Still images and GIF
frames go through the same path, which is why filters, layers and export behave
identically for both.

Every remote call is wrapped: if Imgflip, Memegen, Reddit or the font catalogue
is unreachable, the app says so in the panel and keeps working with what it has.
Images from hosts that send no CORS headers are retried through public image
proxies so exports stay possible.

## Third-party code

Vendored in `vendor/` so the app has no CDN dependency and works offline:

| Library | Version | Licence | Used for |
| --- | --- | --- | --- |
| [Fabric.js](https://fabricjs.com) | 6.9.1 | MIT | canvas object model, transforms, text editing |
| [gifuct-js](https://github.com/matt-way/gifuct-js) | 2.1.2 | MIT | GIF decoding |
| [gif.js](https://github.com/jnordberg/gif.js) | 0.2.0 | MIT | GIF encoding |
| [Fuse.js](https://fusejs.io) | 7.5.0 | Apache-2.0 | fuzzy template search |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval) | 6.3.0 | Apache-2.0 | IndexedDB storage |
| [SortableJS](https://sortablejs.github.io/Sortable/) | 1.15.7 | MIT | drag to restack layers |
| Archivo, Anton, IBM Plex Mono | Fontsource 5.3 | OFL-1.1 | the interface itself |

MemeForge is MIT licensed — see [LICENSE](LICENSE).
