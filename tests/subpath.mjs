// GitHub Pages serves a project site from /<repo>/, not from the domain root.
// This checks that every path in the app — modules, fonts, the service worker,
// the GIF encoder's worker script — still resolves one directory down.
//
//   (cd .. && python3 -m http.server 8100 &)
//   node tests/subpath.mjs

import { chromium } from 'playwright';
import { basename, resolve } from 'node:path';

const repo = basename(resolve('.'));
const BASE = process.env.SUBPATH_URL || `http://127.0.0.1:8100/${repo}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });

const problems = [];
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  if (res.status() >= 400 && res.url().startsWith(new URL(BASE).origin)) {
    problems.push(`${res.status()} ${res.url()}`);
  }
});

const host = new URL(BASE).hostname;
await page.route('**/*', (route) => (
  new URL(route.request().url()).hostname === host ? route.continue() : route.abort()
));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(4000);

await page.setInputFiles('#file-input', 'tests/fixtures/sample.png');
await page.waitForFunction(() => window.studio?.hasMedia, null, { timeout: 15000 });
await page.locator('.rail-btn[data-panel="text"]').click();
await page.locator('#add-classic').click();
await page.waitForTimeout(500);

check('canvas takes the picture', await page.evaluate(() => window.studio.canvas.width === 640));
check('bundled interface fonts load', await page.evaluate(
  () => document.fonts.check('400 20px Archivo') && document.fonts.check('400 20px Anton'),
));

const scopes = await page.evaluate(
  () => navigator.serviceWorker.getRegistrations().then((regs) => regs.map((r) => r.scope)),
);
check('service worker scoped to the subpath', scopes.some((s) => s.endsWith(`/${repo}/`)), scopes.join(','));

await page.setInputFiles('#file-input', 'tests/fixtures/sample.gif');
await page.waitForFunction(() => window.studio?.isAnimated, null, { timeout: 20000 });
const size = await page.evaluate(async () => (await window.studio.toGifBlob({ scale: 1 })).size);
check('GIF worker script resolves', size > 2000, `${size} bytes`);

check('no 404s and no exceptions', problems.length === 0, problems.slice(0, 3).join(' | '));

await page.screenshot({ path: 'tests/shots/07-subpath.png' });
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
