// GIF decoding (gifuct-js) and encoding (gif.js), plus media normalisation.

import gifuct from '../vendor/gifuct.mjs';
import { fetchBuffer } from './util.js';

const { parseGIF, decompressFrames } = gifuct;

export const MAX_FRAMES = 1200;
const MAX_DECODE_BYTES = 192 * 1024 * 1024;

export const isGifUrl = (url = '') => /\.gif(\?|#|$)/i.test(url) || url.startsWith('data:image/gif');

/** Decode a GIF into fully composited frame canvases. */
export function decodeGif(buffer) {
  const gif = parseGIF(buffer);
  const count = gif.frames.filter((f) => f.image).length;
  if (count > MAX_FRAMES || gif.lsd.width * gif.lsd.height * Math.max(count, 1) * 4 > MAX_DECODE_BYTES) {
    throw new Error('This GIF is too large to edit safely. Use a smaller resolution or a shorter GIF (no frames were cut).');
  }
  const raw = decompressFrames(gif, true);
  if (!raw.length) throw new Error('That GIF has no frames.');

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const stage = document.createElement('canvas');
  stage.width = width;
  stage.height = height;
  const ctx = stage.getContext('2d', { willReadFrequently: true });

  const patch = document.createElement('canvas');
  const patchCtx = patch.getContext('2d');

  const frames = [];
  let restore = null;

  for (const frame of raw) {
    if (restore) {
      ctx.putImageData(restore, 0, 0);
      restore = null;
    }
    if (frame.disposalType === 3) {
      restore = ctx.getImageData(0, 0, width, height);
    }

    patch.width = frame.dims.width;
    patch.height = frame.dims.height;
    patchCtx.putImageData(
      new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height),
      0,
      0,
    );
    ctx.drawImage(patch, frame.dims.left, frame.dims.top);

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    out.getContext('2d').drawImage(stage, 0, 0);
    frames.push({ canvas: out, delay: Math.max(10, frame.delay || 100) });

    if (frame.disposalType === 2) {
      ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }
  }

  return { width, height, frames };
}

export async function loadGif(url) {
  return decodeGif(await fetchBuffer(url));
}

let encoderReady;
function loadEncoder() {
  if (globalThis.GIF) return Promise.resolve();
  encoderReady ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/gif.js', import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('The GIF encoder could not be loaded.'));
    document.head.append(script);
  });
  return encoderReady;
}

/**
 * Encode an animated GIF. Frames are pulled one at a time through `frameAt`
 * so the caller can reuse a single canvas instead of holding every frame.
 */
export async function encodeGif({ width, height, count, frameAt, onProgress, quality = 8, colors = 256, dither = false, repeat = 0, signal }) {
  if (signal?.aborted) throw new DOMException('GIF encoding cancelled.', 'AbortError');
  await loadEncoder();
  if (signal?.aborted) throw new DOMException('GIF encoding cancelled.', 'AbortError');
  const encoder = new globalThis.GIF({
    workers: Math.min(4, navigator.hardwareConcurrency || 2),
    quality: Math.max(1, Math.min(30, Number(quality) || 8)),
    dither: dither ? "FloydSteinberg" : false,
    repeat,
    ...(colors < 256 ? { globalPalette: reducedPalette(colors) } : {}),
    width,
    height,
    workerScript: new URL('../vendor/gif.worker.js', import.meta.url).href,
  });

  if (width * height * count * 4 > 384 * 1024 * 1024) throw new Error('Export is too large. Try 1× scale or trim the GIF.');
  let desiredTime = 0, encodedTime = 0;
  for (let i = 0; i < count; i += 1) {
    const { canvas, delay } = frameAt(i);
    desiredTime += delay;
    const rounded = Math.round(desiredTime / 10) * 10;
    const frameDelay = Math.max(10, rounded - encodedTime); encodedTime += frameDelay;
    encoder.addFrame(canvas, { delay: frameDelay, copy: true });
    if (onProgress) onProgress((i / count) * 0.5);
  }

  return new Promise((resolve, reject) => {
    const workers = () => [...encoder.freeWorkers, ...encoder.activeWorkers];
    const cleanup = () => { signal?.removeEventListener('abort', cancel); for (const worker of workers()) worker.terminate(); };
    const cancel = () => { encoder.abort(); };
    if (onProgress) encoder.on('progress', (p) => onProgress(0.5 + p * 0.5));
    encoder.on('finished', (blob) => { cleanup(); resolve(blob); });
    encoder.on('error', (error) => { cleanup(); reject(error); });
    encoder.on('abort', () => { cleanup(); reject(new DOMException('GIF encoding cancelled.', 'AbortError')); });
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      encoder.render();
      for (const worker of workers()) worker.onerror = () => { cleanup(); reject(new Error('The GIF worker failed. Please try a smaller output.')); };
    } catch (error) { cleanup(); reject(error); }
  });
}

// A deterministic RGB palette for optional color reduction; the encoder expects
// 256 slots, so unused slots repeat the last color.
export function reducedPalette(count) {
  const bits = { 32: [2, 2, 1], 64: [2, 2, 2], 128: [3, 2, 2] }[count] || [2, 2, 2];
  const levels = bits.map((b) => 2 ** b);
  const palette = [];
  for (let r = 0; r < levels[0]; r++) for (let g = 0; g < levels[1]; g++) for (let b = 0; b < levels[2]; b++) {
    palette.push(Math.round(r * 255 / (levels[0] - 1)), Math.round(g * 255 / (levels[1] - 1)), Math.round(b * 255 / (levels[2] - 1)));
  }
  const last = palette.slice(-3);
  while (palette.length < 768) palette.push(...last);
  return palette;
}

export function checkFrameBudget(width, height, count) {
  if (count > MAX_FRAMES || width * height * count * 4 > MAX_DECODE_BYTES) throw new Error('Too many pixels to edit. Shorten the clip, lower FPS or reduce its width.');
}

export async function openVideo(file) {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const url = URL.createObjectURL(file);
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video metadata timed out.')), 15000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('This browser cannot decode this video. Try MP4 or WebM.')); };
    });
    if (!Number.isFinite(video.duration) || !video.videoWidth) throw new Error('Video duration is unavailable.');
    return { video, close: () => { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); } };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function videoFrames(video, { start = 0, end = video.duration, fps = 24, width = 480, onProgress, signal } = {}) {
  start = Math.max(0, Number(start)); end = Math.min(video.duration, Number(end));
  fps = Math.max(1, Math.min(60, Number(fps)));
  if (!(end > start)) throw new Error('The end must be after the start.');
  width = Math.round(Math.max(32, Math.min(720, Number(width))));
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  const count = Math.ceil((end - start) * fps - 1e-6);
  checkFrameBudget(width, height, count);
  const frames = [];
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new DOMException('Video import cancelled.', 'AbortError');
    const at = start + i / fps;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { clean(); reject(new Error('Video seeking timed out.')); }, 10000);
      const clean = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', failed); };
      const done = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(new Error('Video decoding failed.')); };
      video.addEventListener('seeked', done); video.addEventListener('error', failed);
      video.currentTime = Math.min(at + 0.00001, video.duration - 0.00001);
    });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    frames.push({ canvas, delay: Math.max(10, Math.min(1000 / fps, (end - at) * 1000)) });
    onProgress?.((i + 1) / count);
  }
  return { width, height, frames };
}

export function combineGifs(clips, mode = 'sequence', width = 480) {
  if (clips.length < 2) throw new Error('Choose at least two GIFs.');
  width = Math.max(32, Math.min(720, Math.round(width)));
  const durations = clips.map((c) => c.frames.reduce((n, f) => n + f.delay, 0));
  const boundaries = clips.map((c) => { let at = 0; return c.frames.map((f) => { const begin = at; at += f.delay; return begin; }); });
  const height = mode === 'parallel' ? Math.max(...clips.map((c) => Math.round((width / clips.length) * c.height / c.width))) : Math.max(...clips.map((c) => Math.round(width * c.height / c.width)));
  let plan;
  if (mode === 'parallel') {
    const duration = Math.max(...durations);
    const times = [...new Set(boundaries.flat().concat(duration))].sort((a, b) => a - b);
    // GIF cannot represent sub-centisecond boundaries. Merge those intervals.
    plan = [];
    for (let i = 0; i < times.length - 1; i++) {
      const delay = times[i + 1] - times[i];
      if (delay < 10 && plan.length) plan.at(-1).delay += delay;
      else plan.push({ at: times[i], delay });
    }
  } else plan = clips.flatMap((c, clip) => c.frames.map((frame) => ({ clip, frame, delay: frame.delay })));
  checkFrameBudget(width, height, plan.length);
  const frames = plan.map((step) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    const draw = (frame, x, cellWidth) => {
      const ratio = Math.min(cellWidth / frame.canvas.width, height / frame.canvas.height);
      const w = frame.canvas.width * ratio, h = frame.canvas.height * ratio;
      ctx.drawImage(frame.canvas, x + (cellWidth - w) / 2, (height - h) / 2, w, h);
    };
    if (mode === 'parallel') clips.forEach((c, i) => {
      let index = boundaries[i].findLastIndex((t) => t <= step.at); index = Math.max(0, index);
      draw(c.frames[index], i * width / clips.length, width / clips.length);
    }); else draw(step.frame, 0, width);
    return { canvas, delay: step.delay };
  });
  return { width, height, frames };
}

export function gifFootprint(buffer) {
  const gif = parseGIF(buffer);
  return gif.lsd.width * gif.lsd.height * Math.max(1, gif.frames.filter((f) => f.image).length) * 4;
}
