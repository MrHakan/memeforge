// End-to-end smoke test. Runs the real app against stubbed meme APIs so the
// whole path — template grid, canvas, fonts, filters, export — is exercised
// without depending on anyone else's uptime.
//
//   node tests/make-fixtures.mjs
//   npx http-server -p 8099 .   (or python3 -m http.server 8099)
//   node tests/smoke.mjs

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'shots');
const fixtures = join(here, 'fixtures');
mkdirSync(shots, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099';
const SAMPLE = `${BASE}/tests/fixtures/sample.png`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function stub(page) {
  await page.route('**/api.imgflip.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        memes: [
          { id: '1', name: 'Distracted Boyfriend', url: SAMPLE, width: 640, height: 480, box_count: 3 },
          { id: '2', name: 'Drake Hotline Bling', url: SAMPLE, width: 640, height: 480, box_count: 2 },
          { id: '3', name: 'Two Buttons', url: SAMPLE, width: 640, height: 480, box_count: 3 },
        ],
      },
    }),
  }));

  await page.route('**/api.memegen.link/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'ds', name: 'Daily Struggle', blank: `${BASE}/tests/fixtures/sample2.png`, lines: 3, keywords: ['buttons'] },
      { id: 'fry', name: 'Futurama Fry', blank: `${BASE}/tests/fixtures/sample2.png`, lines: 2, keywords: ['squint'] },
    ]),
  }));

  await page.route('**/meme-api.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      memes: [
        { title: 'A very funny post', url: SAMPLE, preview: [SAMPLE, SAMPLE], author: 'someone', ups: 4210, subreddit: 'memes', postLink: 'https://reddit.com/1' },
        { title: 'Another one', url: SAMPLE, preview: [SAMPLE, SAMPLE], author: 'someone', ups: 88, subreddit: 'memes', postLink: 'https://reddit.com/2' },
      ],
    }),
  }));

  await page.route('**/api.fontsource.org/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'bangers', family: 'Bangers', category: 'display', subsets: ['latin'] },
      { id: 'lobster', family: 'Lobster', category: 'handwriting', subsets: ['latin'] },
      { id: 'roboto', family: 'Roboto', category: 'sans-serif', subsets: ['latin'] },
      { id: 'lora', family: 'Lora', category: 'serif', subsets: ['latin'] },
    ]),
  }));

  // Any Google font resolves to a real bundled file, so document.fonts.load resolves.
  await page.route('**/fonts.googleapis.com/**', (route) => {
    const family = decodeURIComponent(new URL(route.request().url()).searchParams.get('family') || 'X')
      .split(':')[0].replace(/\+/g, ' ');
    return route.fulfill({
      contentType: 'text/css',
      body: `@font-face{font-family:"${family}";font-style:normal;font-weight:400;src:url(${BASE}/vendor/fonts/anton-latin-400-normal.woff2) format('woff2');}
             @font-face{font-family:"${family}";font-style:normal;font-weight:700;src:url(${BASE}/vendor/fonts/anton-latin-400-normal.woff2) format('woff2');}`,
    });
  });
}

/** Build an animated GIF with the bundled encoder so the GIF path can be tested. */
async function makeGifFixture(page) {
  const target = join(fixtures, 'sample.gif');
  if (existsSync(target)) return target;
  await page.goto(`${BASE}/index.html`);
  const base64 = await page.evaluate(async (origin) => {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${origin}/vendor/gif.js`;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
    const gif = new window.GIF({ workers: 1, quality: 10, width: 240, height: 180, workerScript: `${origin}/vendor/gif.worker.js` });
    for (let i = 0; i < 6; i += 1) {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 180;
      const ctx = c.getContext('2d');
      ctx.fillStyle = `hsl(${i * 55}, 70%, 45%)`;
      ctx.fillRect(0, 0, 240, 180);
      ctx.fillStyle = '#fff';
      ctx.fillRect(20 + i * 30, 60, 60, 60);
      gif.addFrame(c, { delay: 120 });
    }
    const blob = await new Promise((resolve) => { gif.on('finished', resolve); gif.render(); });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let out = '';
    for (const byte of buf) out += String.fromCharCode(byte);
    return btoa(out);
  }, BASE);
  writeFileSync(target, Buffer.from(base64, 'base64'));
  return target;
}

const run = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  // Spend the light-mode easter egg up front; tests/flashbang.mjs covers it.
  await context.addInitScript(() => {
    localStorage.setItem('mf.settings.v1', JSON.stringify({ theme: 'dark', flashbanged: true }));
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await stub(page);
  const gifPath = await makeGifFixture(page);
  check('gif fixture built', existsSync(gifPath));

  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector('#template-grid .tile', { timeout: 15000 });
  const tiles = await page.locator('#template-grid .tile').count();
  check('templates merged from both sources', tiles >= 5, `${tiles} tiles`);
  await page.screenshot({ path: join(shots, '01-start.png') });

  // load a template
  await page.locator('#template-grid .tile').first().click();
  await page.waitForFunction(() => window.studio?.hasMedia, null, { timeout: 15000 });
  check('template loads onto the bench', await page.evaluate(() => window.studio.canvas.width === 640));

  await page.waitForFunction(() => window.studio.canvas.getObjects().length === 3);
  check('recognized template receives positioned editable captions', true);
  await page.evaluate(() => window.studio.clearLayers());

  // classic meme text
  await page.locator('.rail-btn[data-panel="text"]').click();
  await page.locator('#add-classic').click();
  await page.waitForTimeout(300);
  const layerCount = await page.evaluate(() => window.studio.canvas.getObjects().length);
  check('top and bottom text added', layerCount === 2, `${layerCount} layers`);

  // fonts: search, apply, verify it actually loaded
  await page.fill('#font-search', 'bangers');
  await page.waitForTimeout(400);
  await page.locator('.font-row', { hasText: 'Bangers' }).first().click();
  await page.waitForTimeout(700);
  const fontState = await page.evaluate(() => ({
    family: window.studio.canvas.getActiveObject()?.fontFamily,
    loaded: document.fonts.check('400 40px "Bangers"'),
  }));
  check('font applied to the selected text', fontState.family === 'Bangers', JSON.stringify(fontState));
  check('font file actually loaded', fontState.loaded === true);

  // type into the inspector
  await page.fill('#inspector-body textarea', 'when the code compiles');
  await page.waitForTimeout(200);
  const textValue = await page.evaluate(() => window.studio.canvas.getActiveObject()?.text);
  check('inspector retypes the layer in caps', textValue === 'WHEN THE CODE COMPILES', textValue);

  // sticker
  await page.locator('.rail-btn[data-panel="stickers"]').click();
  await page.locator('.sticker').first().click();
  await page.waitForTimeout(200);
  check('sticker added', await page.evaluate(() => window.studio.canvas.getObjects().length === 3));

  // picture layer
  await page.setInputFiles('#layer-image-input', join(fixtures, 'sample2.png'));
  await page.waitForTimeout(600);
  check('picture added as a layer', await page.evaluate(
    () => window.studio.canvas.getObjects().filter((o) => o.mfKind === 'image').length === 1,
  ));
  await page.evaluate(() => window.studio.removeSelected());
  await page.waitForTimeout(200);

  // trending feed
  await page.locator('.rail-btn[data-panel="trending"]').click();
  await page.waitForSelector('#trending-feed .post', { timeout: 10000 });
  const posts = await page.locator('#trending-feed .post').count();
  check('trending feed lists posts', posts === 2, `${posts} posts`);

  // restacking
  const stackBefore = await page.evaluate(() => window.studio.layers().map((l) => l.name).join(' | '));
  await page.evaluate(() => window.studio.reorder(0, 2));
  const stackAfter = await page.evaluate(() => window.studio.layers().map((l) => l.name).join(' | '));
  check('layers can be restacked', stackBefore !== stackAfter, `${stackAfter}`);
  await page.evaluate(() => window.studio.reorder(2, 0));

  // adjust
  await page.locator('.rail-btn[data-panel="adjust"]').click();
  await page.locator('.preset[data-filter="deepfry"]').click();
  await page.waitForTimeout(600);
  check('deep fry preset applied', await page.evaluate(() => window.studio.adjust.saturate === 320));
  await page.screenshot({ path: join(shots, '02-edited.png') });

  // layers panel + reordering data
  await page.locator('.rail-btn[data-panel="layers"]').click();
  const layerRows = await page.locator('#layer-list .layer').count();
  check('layers listed', layerRows === 3, `${layerRows} rows`);

  // undo / redo — filters and layers share one history
  await page.locator('#undo-btn').click();
  await page.waitForTimeout(500);
  const undoneFilter = await page.evaluate(() => window.studio.adjust.saturate);
  check('undo reverts the filter', undoneFilter === 100, `saturate ${undoneFilter}`);
  await page.locator('#redo-btn').click();
  await page.waitForTimeout(400);

  const base = await page.evaluate(() => window.studio.canvas.getObjects().length);
  await page.evaluate(() => window.studio.addShape('ellipse'));
  await page.waitForTimeout(300);
  await page.locator('#undo-btn').click();
  await page.waitForTimeout(500);
  const afterUndo = await page.evaluate(() => window.studio.canvas.getObjects().length);
  await page.locator('#redo-btn').click();
  await page.waitForTimeout(500);
  const afterRedo = await page.evaluate(() => window.studio.canvas.getObjects().length);
  check('undo removes a new layer', afterUndo === base, `${base + 1} → ${afterUndo}`);
  check('redo brings it back', afterRedo === base + 1, `${afterUndo} → ${afterRedo}`);
  await page.locator('#undo-btn').click();
  await page.waitForTimeout(400);

  // export PNG
  await page.locator('#export-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('[data-export="png"]').click(),
  ]);
  const pngPath = join(shots, 'export.png');
  await download.saveAs(pngPath);
  const { size } = await import('node:fs').then((fs) => fs.statSync(pngPath));
  check('PNG export downloads', size > 5000, `${size} bytes, ${download.suggestedFilename()}`);

  // save to gallery
  await page.locator('#save-btn').click();
  await page.waitForTimeout(600);
  await page.locator('.rail-btn[data-panel="gallery"]').click();
  await page.waitForTimeout(400);
  const cards = await page.locator('.gallery-card').count();
  check('saved meme appears in the gallery', cards === 1, `${cards} cards`);

  // GIF: upload, play, export
  await page.locator('.rail-btn[data-panel="templates"]').click();
  await page.setInputFiles('#file-input', gifPath);
  await page.waitForFunction(() => window.studio?.isAnimated, null, { timeout: 20000 });
  const frames = await page.evaluate(() => window.studio.media.frames.length);
  check('GIF decoded into frames', frames === 6, `${frames} frames`);

  const fitted = await page.evaluate(() => {
    const c = window.studio.canvas;
    return c.getObjects().every((o) => o.getScaledWidth() <= c.width * 1.02);
  });
  check('layers rescale onto the new picture', fitted);

  await page.locator('.rail-btn[data-panel="text"]').click();
  await page.locator('#add-text').click();
  await page.waitForTimeout(300);
  await page.locator('#export-btn').click();
  const [gifDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    (async () => { await page.locator('[data-export="gif"]').click(); await page.locator('#output-merge').uncheck(); await page.locator('#output-generate').click(); await page.locator('#editor-apply').click({ timeout: 60000 }); })(),
  ]);
  const gifOut = join(shots, 'export.gif');
  await gifDownload.saveAs(gifOut);
  const gifSize = (await import('node:fs')).statSync(gifOut).size;
  check('animated GIF export downloads', gifSize > 2000, `${gifSize} bytes`);
  await page.screenshot({ path: join(shots, '03-gif.png') });

  // uploads land under "Yours", library templates do not
  await page.locator('.rail-btn[data-panel="templates"]').click();
  await page.locator('#template-chips .chip[data-source="local"]').click();
  await page.waitForTimeout(500);
  const mine = await page.locator('#template-grid .tile').count();
  check('uploads show under Yours', mine === 1, `${mine} tiles`);
  await page.locator('#template-chips .chip[data-source="all"]').click();

  // light theme
  await page.locator('#theme-btn').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, '04-light.png') });
  await page.locator('#theme-btn').click();

  // mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, '05-mobile.png'), fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on mobile', overflow <= 1, `${overflow}px`);

  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
