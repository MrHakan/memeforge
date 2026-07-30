// The light-mode easter egg: it fires once, then never again.
//
//   npm run dev &
//   node tests/flashbang.mjs

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

// --- fresh device: the grenade comes in ---
const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
const page = await context.newPage();
await page.route('**/*', (route) => (
  new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
));
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2500);

await page.locator('#theme-btn').click();
check('theme switched to light', await page.evaluate(() => document.documentElement.dataset.theme === 'light'));
check('grenade deployed', await page.locator('.fb .fb-nade').count() === 1);

for (const [label, at] of [['throw', 260], ['land', 780], ['flash', 1080], ['fade', 2400]]) {
  await page.waitForTimeout(at - (Number(globalThis.__last) || 0));
  globalThis.__last = at;
  await page.screenshot({ path: join(shots, `08-flashbang-${label}.png`) });
}

const midFlash = await page.evaluate(() => {
  const white = document.querySelector('.fb-white');
  return white ? Number(getComputedStyle(white).opacity) : -1;
});
check('screen was still lit at 2.4s', midFlash > 0 && midFlash < 1, `opacity ${midFlash}`);

await page.waitForTimeout(2600);
check('cleans itself up', await page.locator('.fb').count() === 0);
check('flag remembered', await page.evaluate(
  () => JSON.parse(localStorage.getItem('mf.settings.v1')).flashbanged === true,
));

// --- same device, second time: nothing happens ---
await page.locator('#theme-btn').click();   // back to dark
await page.waitForTimeout(200);
await page.locator('#theme-btn').click();   // light again
await page.waitForTimeout(400);
check('never fires twice', await page.locator('.fb').count() === 0);

await page.reload();
await page.waitForTimeout(2000);
await page.locator('#theme-btn').click();
await page.locator('#theme-btn').click();
await page.waitForTimeout(400);
check('still quiet after a reload', await page.locator('.fb').count() === 0);
await context.close();

// --- someone who asked for reduced motion is left in peace ---
const calm = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: 'reduce' });
const calmPage = await calm.newPage();
await calmPage.route('**/*', (route) => (
  new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
));
await calmPage.goto(`${BASE}/index.html`);
await calmPage.waitForTimeout(2200);
await calmPage.locator('#theme-btn').click();
await calmPage.waitForTimeout(500);
check('reduced motion: no grenade', await calmPage.locator('.fb').count() === 0);
check('reduced motion: theme still switches', await calmPage.evaluate(
  () => document.documentElement.dataset.theme === 'light',
));
check('reduced motion: keeps its one shot for later', await calmPage.evaluate(
  () => !JSON.parse(localStorage.getItem('mf.settings.v1')).flashbanged,
));
await calm.close();

await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
