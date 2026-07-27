// Degradation test: every off-origin request fails. The app should still load,
// say plainly what is unreachable, and stay usable with bundled fonts.
//
//   npm run dev &
//   node tests/offline.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const shots = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(shots, { recursive: true });
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });

const crashes = [];
page.on('pageerror', (err) => crashes.push(err.message));

const host = new URL(BASE).hostname;
await page.route('**/*', (route) => (
  new URL(route.request().url()).hostname === host ? route.continue() : route.abort()
));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(6000);

const note = await page.locator('#template-note').textContent();
check('template panel names the dead sources', /not answering/.test(note), note.trim());

const grid = (await page.locator('#template-grid').textContent()).trim();
check('grid points at uploads instead', /unreachable/.test(grid), grid.slice(0, 70));

await page.locator('.rail-btn[data-panel="text"]').click();
const fontRows = await page.locator('.font-row').count();
check('bundled fonts still listed', fontRows > 40, `${fontRows} fonts`);

await page.locator('.rail-btn[data-panel="trending"]').click();
await page.waitForTimeout(2500);
const trending = await page.locator('#trending-note').textContent();
check('trending explains itself', /not reachable/.test(trending), trending.trim());

const workers = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
check('service worker registered', workers === 1);

check('no uncaught exceptions', crashes.length === 0, crashes.slice(0, 2).join(' | '));

await page.locator('.rail-btn[data-panel="templates"]').click();
await page.screenshot({ path: join(shots, '06-offline.png') });
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
