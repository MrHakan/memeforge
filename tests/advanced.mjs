import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099';
let checks = 0;
const check = (name, value) => { assert.ok(value, name); console.log(`PASS  ${name}`); checks++; };
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack));
  await page.route('**/*', async (r) => {
    if (r.request().url().startsWith(BASE) || /^(blob|data):/.test(r.request().url())) return r.continue();
    if (r.request().url().includes('api.imgflip.com')) return r.fulfill({ json: { success: true, data: { memes: [] } } });
    if (r.request().url().includes('api.memegen.link')) return r.fulfill({ json: [] });
    return r.abort();
  });
  await page.goto(BASE); await page.waitForFunction(() => window.advanced);
  const gif64 = await page.evaluate(async () => {
    const { encodeGif } = await import('./js/media.js');
    const c = document.createElement('canvas'); c.width = 240; c.height = 180; const ctx = c.getContext('2d');
    const blob = await encodeGif({ width: 240, height: 180, count: 6, frameAt: (i) => {
      ctx.fillStyle = `hsl(${i * 55},70%,45%)`; ctx.fillRect(0, 0, 240, 180); ctx.fillStyle = '#fff'; ctx.fillRect(20 + i * 30, 60, 60, 60); return { canvas: c, delay: 120 };
    } });
    window.advancedFixture = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    return window.advancedFixture.split(',')[1];
  });
  const load = async () => {
    await page.evaluate(async (base) => { studio.clearLayers(); await loadMedia({ src: window.advancedFixture, kind: 'gif', name: 'Sample', source: 'upload' }); studio.seek(0); }, BASE);
  };
  await load();
  await page.locator('#mode-frame').click();
  await page.locator('[data-frame="1"]').click();
  await page.locator('[data-frame="3"]').click({ modifiers: ['Shift'] });
  check('Shift selects a frame interval', await page.evaluate(() => studio.selectedFrameIds.size === 3));
  await page.locator('[data-frame="5"]').click({ modifiers: ['Control'] });
  check('Ctrl adds an individual frame', await page.evaluate(() => studio.selectedFrameIds.size === 4));
  await page.locator('[data-frame="5"]').click({ modifiers: ['Control'] });
  check('Ctrl toggles an individual frame off', await page.evaluate(() => studio.selectedFrameIds.size === 3));
  await page.evaluate(() => { studio.addText('BATCH'); studio.update({ fontSize: 12, left: 40 }); studio.setAdjust({ saturate: 0 }); });
  check('new layers bind to all selected frames', await page.evaluate(() => studio.selected().mfFrameIds.length === 3));
  check('batch filters affect only selected frames', await page.evaluate(() => {
    const f = studio.media.frames; return [1, 2, 3].every((i) => studio.frameAdjust[f[i].id]?.saturate === 0) && !studio.frameAdjust[f[0].id];
  }));
  await page.evaluate(() => studio.update({ text: 'UPDATED', left: 60 }));
  check('batch text and position overrides are saved per frame', await page.evaluate(() => [1, 2, 3].every((i) => studio.selected().mfOverrides[studio.media.frames[i].id]?.left === 60)));
  await page.fill('#frame-delay', '150'); await page.locator('#selected-delay').click();
  check('selected delay preserves unselected timing', await page.evaluate(() => studio.media.frames[0].delay === 120 && studio.media.frames[2].delay === 150 && studio.duration === 810));
  await page.locator('#selected-delete').click();
  check('delete selected frames handles non-current selection', await page.evaluate(() => studio.media.frames.length === 3));
  await page.evaluate(() => studio.undo());
  check('batch deletion is undoable', await page.evaluate(() => studio.media.frames.length === 6 && studio.duration === 810));
  await page.evaluate(() => { studio.seek(1); studio.canvas.setActiveObject(studio.canvas.getObjects()[0]); studio.update({ text: 'COPY' }); studio.selectFrames(3, { shiftKey: true }); studio.seek(1, true, true); });
  await page.locator('#copy-frame-edits').click();
  check('copy current edits duplicates overrides without sharing objects', await page.evaluate(() => {
    const o = studio.selected(), f = studio.media.frames; return o.mfOverrides[f[3].id].text === 'COPY' && o.mfOverrides[f[1].id] !== o.mfOverrides[f[3].id];
  }));
  await page.evaluate(() => {
    studio.seek(1); studio.update({ text: 'ONE' }); studio.seek(2); studio.update({ text: 'TWO' });
    studio.selectFrames(1); studio.selectFrames(3, { shiftKey: true }); studio.update({ fill: '#00ff00' });
  });
  check('batch styling preserves unrelated frame-specific text', await page.evaluate(() => {
    const o = studio.selected(), f = studio.media.frames; return o.mfOverrides[f[1].id].text === 'ONE' && o.mfOverrides[f[2].id].text === 'TWO' && [1,2,3].every(i=>o.mfOverrides[f[i].id].fill === '#00ff00');
  }));
  await page.waitForSelector('.track-bar');
  const bar = page.locator('.track-bar').first();
  await bar.focus(); await bar.press('ArrowRight');
  check('keyboard moves the layer timing strip', await page.evaluate(() => studio.canvas.getObjects()[0].mfFrameIds.every((id, i) => id === studio.media.frames[i + 2].id)));
  await page.locator('.track-handle.end').first().focus(); await page.locator('.track-handle.end').first().press('ArrowRight');
  check('timing handle extends a layer range', await page.evaluate(() => studio.canvas.getObjects()[0].mfFrameIds.length === 4));
  await page.evaluate(() => studio.undo());
  check('track edits participate in undo', await page.evaluate(() => studio.canvas.getObjects()[0].mfFrameIds.length === 3));
  await page.waitForFunction(() => document.querySelector('.track-bar')?.getAttribute('aria-label').endsWith('to 5'));
  const handle = await page.locator('.track-handle.start').first().boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 10); await page.mouse.down(); await page.mouse.move(handle.x + 190, handle.y + 10, { steps: 5 }); await page.mouse.up();
  check('pointer drag trims the timing strip', await page.evaluate(() => studio.canvas.getObjects()[0].mfFrameIds.length < 3));
  await page.evaluate(() => studio.undo());
  await page.evaluate(() => studio.seek(2));
  const beforeOnion = await page.evaluate(async () => [...new Uint8Array(await (await studio.toBlob()).arrayBuffer())].join(','));
  await page.locator('#onion-toggle').check();
  check('onion skin shows adjacent frames while editing', await page.locator('.onion-overlay').isVisible());
  const afterOnion = await page.evaluate(async () => [...new Uint8Array(await (await studio.toBlob()).arrayBuffer())].join(','));
  check('onion skin never appears in exports', beforeOnion === afterOnion);
  await page.evaluate(() => studio.play()); check('onion skin hides during playback', !await page.locator('.onion-overlay').isVisible()); await page.evaluate(() => studio.pause());

  await load(); await page.locator('#mode-video').click();
  await page.evaluate(() => { studio.addShape('bar'); studio.update({ fill: '#ff0000', left: 80, top: 50 }); studio.setLayerRange(1, 5); studio.setAnimation({ kind: 'slide', duration: 300, strength: 30 }); studio.seek(1); });
  check('motion begins at layer start', await page.evaluate(() => studio.selected().left === 50 && studio.selected().mfBase.left === 80));
  await page.evaluate(() => studio.seek(5));
  check('motion finishes at canonical position', await page.evaluate(() => studio.selected().left === 80));
  await page.evaluate(() => { studio.setAnimation({ kind: 'zoom', duration: 300, strength: 50 }); studio.seek(5); studio.update({ fill: '#00ff00' }); studio.seek(5); });
  check('editing an animated layer does not bake its zoom into the base', await page.evaluate(() => studio.selected().mfBase.scaleX === 1 && Math.abs(studio.selected().scaleX - 1.5) < 0.001));
  await page.evaluate(() => { studio.setAnimation({ kind: 'fade', duration: 300, strength: 30 }); studio.seek(1); studio.update({ fill: '#ff0000' }); studio.seek(5); });
  check('editing at zero opacity preserves the fade base', await page.evaluate(() => studio.selected().opacity === 1 && studio.selected().mfBase.opacity === 1));
  const motionProject = await page.evaluate(() => studio.toProject('Motion'));
  await page.evaluate(async (p) => { await studio.fromProject(p); studio.seek(1); }, motionProject);
  check('project restores motion settings and timing tracks', await page.evaluate(() => studio.canvas.getObjects()[0].mfAnimation.kind === 'fade' && studio.canvas.getObjects()[0].opacity === 0));
  const motionPixels = await page.evaluate(async () => {
    const { decodeGif } = await import('./js/media.js'); const gif = decodeGif(await (await studio.toGifBlob()).arrayBuffer());
    return gif.frames.map((f) => [...f.canvas.getContext('2d').getImageData(80, 50, 1, 1).data]);
  });
  check('encoded GIF contains the motion effect', motionPixels[1][0] !== motionPixels[5][0] || motionPixels[1][1] !== motionPixels[5][1]);

  await page.evaluate(() => { studio.clearLayers(); studio.setMode('frame'); studio.seek(2); studio.addRegion('pixelate', 20); studio.update({ left: 10, top: 50, width: 90, height: 80 }); });
  const regionPixels = await page.evaluate(() => {
    studio.seek(2); const a = [...studio.mediaCtx.getImageData(78, 65, 1, 1).data];
    studio.seek(3); const b = [...studio.mediaCtx.getImageData(78, 65, 1, 1).data]; return { a, b, visible: studio.canvas.getObjects()[0].visible };
  });
  check('regional effect follows frame visibility', regionPixels.visible === false && regionPixels.a.join() !== regionPixels.b.join());
  await page.evaluate(() => { studio.seek(2); studio.addRegion('blur', 8); });
  check('regional blur is an editable layer', await page.evaluate(() => studio.selected().mfRegion.kind === 'blur'));
  await page.locator('#drawing-open').click(); await page.selectOption('#draw-kind', 'pen'); await page.locator('#editor-apply').click();
  const canvas = await page.locator('.upper-canvas').boundingBox();
  await page.mouse.move(canvas.x + 15, canvas.y + 15); await page.mouse.down(); await page.mouse.move(canvas.x + 100, canvas.y + 60, { steps: 8 }); await page.mouse.up();
  check('pen creates editable drawing paths', await page.evaluate(() => studio.canvas.getObjects().some((o) => o.mfKind === 'drawing' && o.mfFrameIds.length === 1)));
  await page.locator('#drawing-stop').click(); check('finish drawing restores selection tool', await page.evaluate(() => !studio.canvas.isDrawingMode));
  await page.locator('#drawing-open').click(); await page.selectOption('#draw-kind', 'highlight'); await page.locator('#editor-apply').click();
  check('highlighter uses a translucent brush', await page.evaluate(() => studio.canvas.freeDrawingBrush.color.endsWith('66')));
  await page.locator('#drawing-stop').click();
  await page.locator('#drawing-open').click(); await page.selectOption('#draw-kind', 'bubble'); await page.locator('#editor-apply').click();
  check('speech bubble is an editable vector layer', await page.evaluate(() => studio.selected().mfName === 'bubble'));

  await page.evaluate(async (base) => { studio.clearLayers(); await loadMedia({ src: base + '/tests/fixtures/sample.png', name: 'Drake Hotline Bling', source: 'upload' }); advanced.captionLayout('auto', studio.media.name); }, BASE);
  check('smart captions occupy template-specific panels', await page.evaluate(() => { const [a, b] = studio.canvas.getObjects(); return a.left === studio.canvas.width * 0.75 && a.top < b.top; }));
  await page.locator('#project-menu-btn').click(); await page.locator('#template-save').click();
  await page.waitForFunction(() => document.querySelector('#template-grid').textContent.includes('Drake'));
  await page.evaluate(() => { studio.clearLayers(); });
  await page.locator('#template-grid .tile', { hasText: 'Drake' }).first().click();
  await page.waitForFunction(() => studio.canvas.getObjects().length === 2);
  check('personal templates restore editable text layers', await page.evaluate(() => studio.canvas.getObjects().every((o) => o.type === 'textbox')));
  await page.locator('#caption-layout').click(); await page.selectOption('#caption-kind', 'outside'); await page.locator('#editor-apply').click();
  check('outside caption layout creates padding and editable text', await page.evaluate(() => studio.pad.top > 0 && studio.selected().top === studio.paddingPixels.top / 2));

  await load(); await page.evaluate(() => { studio.setPad({ top: 0, bottom: 0, left: 0, right: 0 }); studio.clearLayers(); });
  const optimized = await page.evaluate(async () => {
    const { decodeGif } = await import('./js/media.js'); const s = studio.snapshot();
    const blob = await studio.toGifBlob({ scale: 0.5, colors: 64, drop: 3, dither: true }); const gif = decodeGif(await blob.arrayBuffer());
    const colors = new Set(); gif.frames.forEach((f) => { const d = f.canvas.getContext('2d').getImageData(0, 0, gif.width, gif.height).data; for (let i = 0; i < d.length; i += 4) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); });
    return { count: gif.frames.length, duration: gif.frames.reduce((n, f) => n + f.delay, 0), width: gif.width, colors: colors.size, unchanged: s === studio.snapshot() };
  });
  check('optimization applies width and color limits', optimized.width === 120 && optimized.colors <= 64);
  check('frame skipping preserves the full playback duration', optimized.count === 2 && optimized.duration === 720);
  check('output processing preserves the editable project', optimized.unchanged);
  await page.evaluate(() => { studio.seek(0); studio.editFrames('duplicate'); studio.editFrames('duplicate'); });
  const merged = await page.evaluate(async () => {
    const { decodeGif } = await import('./js/media.js'); const gif = decodeGif(await (await studio.toGifBlob({ merge: true })).arrayBuffer());
    return { count: gif.frames.length, first: gif.frames[0].delay, duration: gif.frames.reduce((n, f) => n + f.delay, 0) };
  });
  check('identical rendered frames merge with accumulated delay', merged.count === 6 && merged.first === 360 && merged.duration === 960);
  await page.locator('#optimize-open').click(); await page.fill('#output-target', '0.1'); await page.selectOption('#output-colors', '64'); await page.locator('#output-generate').click();
  await page.waitForFunction(() => document.querySelector('#output-preview').getAttribute('src')?.startsWith('blob:'), null, { timeout: 60000 });
  check('output preview reports actual size and target result', /KB.*Target reached/.test(await page.locator('#output-info').textContent()));
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#editor-apply').click()]);
  check('preview downloads the exact encoded result', readFileSync(await download.path()).subarray(0, 3).toString() === 'GIF');
  await page.locator('#caption-layout').click(); await page.selectOption('#caption-kind', 'outside'); await page.locator('#editor-apply').click();
  check('output dialog cleanup leaves subsequent forms usable', await page.evaluate(() => studio.pad.top > 0));

  const gifBytes = Buffer.from(gif64, 'base64');
  await page.locator('#merge-gifs').click(); await page.setInputFiles('#combine-files', [{ name: 'one.gif', mimeType: 'image/gif', buffer: gifBytes }, { name: 'two.gif', mimeType: 'image/gif', buffer: gifBytes }]);
  await page.fill('#combine-width', '120'); await page.locator('#editor-apply').click();
  await page.waitForFunction(() => !document.querySelector('#editor-dialog').open && studio.media.frames.length === 12, null, { timeout: 60000 });
  check('sequential GIF import preserves both clips and timing', await page.evaluate(() => studio.duration === 1440));
  await page.locator('#merge-gifs').click(); await page.setInputFiles('#combine-files', [{ name: 'one.gif', mimeType: 'image/gif', buffer: gifBytes }, { name: 'two.gif', mimeType: 'image/gif', buffer: gifBytes }]);
  await page.selectOption('#combine-mode', 'parallel'); await page.fill('#combine-width', '120'); await page.locator('#editor-apply').click();
  await page.waitForFunction(() => !document.querySelector('#editor-dialog').open && studio.media.frames.length === 6, null, { timeout: 60000 });
  check('parallel GIF import shares a timeline and fits side by side', await page.evaluate(() => studio.duration === 720 && studio.media.width === 120 && studio.media.height === 45));

  const video64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64; const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30), chunks = []; const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const finished = new Promise((resolve) => { recorder.onstop = resolve; }); recorder.start();
    const begin = performance.now(); const timer = setInterval(() => { ctx.fillStyle = performance.now() - begin < 700 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 96, 64); }, 30);
    await new Promise((r) => setTimeout(r, 1450)); recorder.stop(); await finished; clearInterval(timer); stream.getTracks().forEach((t) => t.stop());
    return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(new Blob(chunks, { type: 'video/webm' })); });
  });
  await page.setInputFiles('#video-file', { name: 'test.webm', mimeType: 'video/webm', buffer: Buffer.from(video64, 'base64') });
  await page.waitForSelector('#video-end'); await page.fill('#video-end', '1'); await page.fill('#video-width', '96'); await page.fill('#video-fps', '24'); await page.locator('#editor-apply').click();
  await page.waitForFunction(() => !document.querySelector('#editor-dialog').open && studio.media.frames.length === 24, null, { timeout: 60000 });
  check('video import extracts the selected section at 24 FPS', await page.evaluate(() => studio.media.frames.length === 24 && studio.duration === 1000 && studio.media.width === 96));
  check('video frames contain decoded movement', await page.evaluate(() => { const f = studio.media.frames, a = f[1].canvas.getContext('2d').getImageData(40, 30, 1, 1).data, b = f.at(-1).canvas.getContext('2d').getImageData(40, 30, 1, 1).data; return a[0] > 180 && b[2] > 180; }));
  await page.evaluate(() => studio.seek(0));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { studio.addText('Mobile'); studio.emit('layers'); });
  await page.waitForSelector('.track-bar');
  check('creative toolbar and timeline fit mobile width', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'tests/shots/12-advanced-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.locator('#inspector-close').evaluate((b) => b.click());
  await page.screenshot({ path: 'tests/shots/13-advanced-timeline.png', fullPage: true });
  if (errors.length) console.log(errors);
  const guards = await page.evaluate(async () => {
    const { checkFrameBudget, videoFrames, combineGifs } = await import('./js/media.js');
    let count = 0; try { checkFrameBudget(720, 720, 1201); } catch { count++; }
    try { await videoFrames({ duration: 60, videoWidth: 1920, videoHeight: 1080 }, { end: 60, fps: 60, width: 720 }); } catch { count++; }
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const clip = { width: 16, height: 16, frames: Array.from({length:700},()=>({ canvas:c, delay:100 })) };
    try { combineGifs([clip,clip]); } catch { count++; }
    return count;
  });
  check('video and combined GIF budgets reject oversized work before allocation', guards === 3);
  check('advanced workflows have no uncaught browser errors', errors.length === 0);
  console.log(`\n${checks}/${checks} advanced checks passed`);
} finally { await browser.close(); }
