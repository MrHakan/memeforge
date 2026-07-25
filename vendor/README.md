# Vendored libraries

These files are unmodified builds pulled from npm and committed so the app has
no CDN dependency, no build step, and works offline. Licences belong to their
respective authors.

| File | Package | Version | Licence |
| --- | --- | --- | --- |
| `fabric.min.mjs` | fabric (`dist/index.min.mjs`) | 6.9.1 | MIT |
| `gifuct.mjs` | gifuct-js, bundled to ESM with esbuild | 2.1.2 | MIT |
| `gif.js`, `gif.worker.js` | gif.js (`dist/`) | 0.2.0 | MIT |
| `fuse.min.mjs` | fuse.js (`dist/fuse.min.mjs`) | 7.5.0 | Apache-2.0 |
| `idb-keyval.mjs` | idb-keyval (`dist/index.js`) | 6.3.0 | Apache-2.0 |
| `sortable.esm.js` | sortablejs (`modular/sortable.esm.js`) | 1.15.7 | MIT |
| `fonts/*.woff2` | @fontsource-variable/archivo, @fontsource/anton, @fontsource/ibm-plex-mono | 5.3.0 | OFL-1.1 |

## Refreshing them

```sh
npm pack fabric@6 gifuct-js@2 gif.js@0.2.0 fuse.js@7 idb-keyval@6 sortablejs@1
# unpack, then copy the files listed above into vendor/

# gifuct-js ships CommonJS sources only, so it is bundled once:
npx esbuild --bundle node_modules/gifuct-js/lib/index.js \
  --format=esm --minify --outfile=vendor/gifuct.mjs
```

`js/media.js` imports the gifuct bundle's default export and destructures
`parseGIF` and `decompressFrames` from it.
