// GIF decoding (gifuct-js) and encoding (gif.js), plus media normalisation.

import gifuct from '../vendor/gifuct.mjs';
import { fetchBuffer } from './util.js';

const { parseGIF, decompressFrames } = gifuct;

export const MAX_FRAMES = 160;

export const isGifUrl = (url = '') => /\.gif(\?|#|$)/i.test(url) || url.startsWith('data:image/gif');

/** Decode a GIF into fully composited frame canvases. */
export function decodeGif(buffer) {
  const gif = parseGIF(buffer);
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

  for (const frame of raw.slice(0, MAX_FRAMES)) {
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
    frames.push({ canvas: out, delay: Math.max(20, frame.delay || 100) });

    if (frame.disposalType === 2) {
      ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }
  }

  return { width, height, frames, truncated: raw.length > MAX_FRAMES };
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
export async function encodeGif({ width, height, count, frameAt, onProgress }) {
  await loadEncoder();
  const encoder = new globalThis.GIF({
    workers: Math.min(4, navigator.hardwareConcurrency || 2),
    quality: 8,
    dither: false,
    width,
    height,
    workerScript: new URL('../vendor/gif.worker.js', import.meta.url).href,
  });

  for (let i = 0; i < count; i += 1) {
    const { canvas, delay } = frameAt(i);
    encoder.addFrame(canvas, { delay, copy: true });
    if (onProgress) onProgress((i / count) * 0.5);
  }

  return new Promise((resolve, reject) => {
    if (onProgress) encoder.on('progress', (p) => onProgress(0.5 + p * 0.5));
    encoder.on('finished', resolve);
    encoder.on('abort', () => reject(new Error('GIF export was cancelled.')));
    encoder.render();
  });
}
