// The bench: one Fabric canvas, a media layer underneath it, and the history
// that lets you take any of it back.

import * as fabric from '../vendor/fabric.min.mjs';
import { decodeGif, isGifUrl, loadGif, encodeGif } from './media.js';
import { loadImage, clamp, uid } from './util.js';

const MAX_IMAGE_EDGE = 1600;
const MAX_GIF_EDGE = 720;
const GIF_EXPORT_FRAMES = 120;

const EXTRA_PROPS = [
  'mfKind', 'mfUpper', 'mfName', 'selectable', 'evented',
  'lockMovementX', 'lockMovementY', 'strokeUniform', 'paintFirst',
];

export const DEFAULT_ADJUST = {
  brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, crunch: 0,
};

export const FILTER_PRESETS = {
  none: {},
  deepfry: { brightness: 118, contrast: 190, saturate: 320, crunch: 78 },
  noir: { saturate: 0, contrast: 145, brightness: 96 },
  faded: { contrast: 78, saturate: 68, brightness: 112 },
  vapor: { hue: 285, saturate: 165, brightness: 108 },
  cursed: { contrast: 165, saturate: 40, hue: 190, blur: 1.2, crunch: 55 },
};

export const TEXT_PRESETS = {
  impact: { fontFamily: 'Impact', fill: '#ffffff', stroke: '#000000', strokeWidth: 0.08, mfUpper: true, shadow: null },
  clean: { fontFamily: 'Archivo', fill: '#ffffff', stroke: '#000000', strokeWidth: 0.02, mfUpper: false, shadow: null },
  neon: { fontFamily: 'Anton', fill: '#fff8b0', stroke: '#ff2d95', strokeWidth: 0.05, mfUpper: true, shadow: '#ff2d95 0px 0px 24px' },
  tag: { fontFamily: 'Permanent Marker', fill: '#ffe14d', stroke: '#1a1a1a', strokeWidth: 0.04, mfUpper: false, shadow: null },
  type: { fontFamily: 'Plex Mono', fill: '#111111', stroke: '', strokeWidth: 0, mfUpper: false, shadow: null },
  quote: { fontFamily: 'Playfair Display', fill: '#ffffff', stroke: '#000000', strokeWidth: 0.015, mfUpper: false, shadow: 'rgba(0,0,0,0.55) 0px 3px 12px' },
};

export class Studio extends EventTarget {
  constructor(canvasEl, stageEl) {
    super();
    this.stageEl = stageEl;
    this.canvas = new fabric.Canvas(canvasEl, {
      preserveObjectStacking: true,
      backgroundColor: '#ffffff',
      selectionColor: 'rgba(255,90,31,.12)',
      selectionBorderColor: '#ff5a1f',
      selectionLineWidth: 1,
    });

    fabric.InteractiveFabricObject.ownDefaults = {
      ...fabric.InteractiveFabricObject.ownDefaults,
      cornerStyle: 'circle',
      cornerColor: '#ffffff',
      cornerStrokeColor: '#ff5a1f',
      borderColor: '#ff5a1f',
      cornerSize: 11,
      transparentCorners: false,
      padding: 2,
    };

    this.media = null;
    this.mediaCanvas = document.createElement('canvas');
    this.mediaCtx = this.mediaCanvas.getContext('2d', { willReadFrequently: true });
    this.mediaImage = null;
    this.crunched = null;

    this.adjust = { ...DEFAULT_ADJUST };
    this.pad = { top: 0, color: '#ffffff' };
    this.filterPreset = 'none';

    this.frameIndex = 0;
    this.playing = false;
    this.timer = null;
    this.displayScale = 1;
    this.tainted = false;

    this.past = [];
    this.future = [];
    this.restoring = false;

    const bump = () => this.commit();
    this.canvas.on('object:added', bump);
    this.canvas.on('object:removed', bump);
    this.canvas.on('object:modified', bump);
    this.canvas.on('text:changed', (e) => {
      this.applyCase(e.target);
      this.emit('layers');
      bump();
    });
    for (const evt of ['selection:created', 'selection:updated', 'selection:cleared']) {
      this.canvas.on(evt, () => this.emit('selection'));
    }

    this.onResize = () => this.fit();
    window.addEventListener('resize', this.onResize);
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* ---------------- media ---------------- */

  get hasMedia() { return !!this.media; }
  get isAnimated() { return this.media?.kind === 'gif'; }

  async setMedia({ src, name = 'Untitled', source = 'upload', kind }) {
    const wantGif = kind === 'gif' || isGifUrl(src);
    const previous = this.media ? { width: this.canvas.width, height: this.canvas.height } : null;
    this.stop();

    let media;
    if (wantGif) {
      try {
        const gif = src.startsWith('data:') || src.startsWith('blob:')
          ? decodeGif(await (await fetch(src)).arrayBuffer())
          : await loadGif(src);
        media = { kind: 'gif', frames: gif.frames, width: gif.width, height: gif.height, truncated: gif.truncated };
      } catch {
        media = null; // a GIF we cannot decode is still a fine still image
      }
    }

    if (!media) {
      const { img, tainted } = await loadImage(src);
      this.tainted = tainted;
      media = { kind: 'image', image: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
    } else {
      this.tainted = false;
    }

    const maxEdge = media.kind === 'gif' ? MAX_GIF_EDGE : MAX_IMAGE_EDGE;
    const scale = Math.min(1, maxEdge / Math.max(media.width, media.height));
    media.width = Math.round(media.width * scale);
    media.height = Math.round(media.height * scale);

    this.media = { ...media, name, source, src };
    this.frameIndex = 0;
    this.crunched = null;

    this.mediaCanvas.width = this.media.width;
    this.mediaCanvas.height = this.media.height;

    this.mediaImage = new fabric.FabricImage(this.mediaCanvas, {
      selectable: false,
      evented: false,
      objectCaching: false,
      left: 0,
      top: 0,
    });

    this.layout();
    if (previous) this.rescaleLayers(previous);
    this.paintMedia();
    this.fit();
    this.emit('media');
    if (this.isAnimated) this.play();
    return this.media;
  }

  /** Keep existing layers where they were, proportionally, on a new picture. */
  rescaleLayers(previous) {
    const fx = this.canvas.width / previous.width;
    const fy = this.canvas.height / previous.height;
    if (!isFinite(fx) || !isFinite(fy) || (fx === 1 && fy === 1)) return;
    const f = Math.min(fx, fy);
    for (const obj of this.canvas.getObjects()) {
      obj.set({
        left: obj.left * fx,
        top: obj.top * fy,
        scaleX: (obj.scaleX || 1) * f,
        scaleY: (obj.scaleY || 1) * f,
      });
      obj.setCoords();
    }
    this.canvas.requestRenderAll();
    this.emit('layers');
  }

  layout() {
    if (!this.media) return;
    const padPx = Math.round(this.media.height * (this.pad.top / 100));
    this.canvas.setDimensions({ width: this.media.width, height: this.media.height + padPx });
    this.canvas.backgroundColor = this.pad.color;
    this.mediaImage.set({ top: padPx, left: 0 });
    this.canvas.backgroundImage = this.mediaImage;
    this.canvas.requestRenderAll();
  }

  filterString() {
    const a = this.adjust;
    const parts = [];
    if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
    if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
    if (a.saturate !== 100) parts.push(`saturate(${a.saturate}%)`);
    if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
    if (a.blur) parts.push(`blur(${a.blur}px)`);
    return parts.join(' ') || 'none';
  }

  currentSource() {
    if (!this.media) return null;
    if (this.crunched) return this.crunched;
    return this.media.kind === 'gif'
      ? this.media.frames[this.frameIndex]?.canvas
      : this.media.image;
  }

  paintMedia() {
    if (!this.media) return;
    const src = this.currentSource();
    if (!src) return;
    const { width, height } = this.mediaCanvas;
    this.mediaCtx.save();
    this.mediaCtx.clearRect(0, 0, width, height);
    this.mediaCtx.filter = this.filterString();
    this.mediaCtx.drawImage(src, 0, 0, width, height);
    this.mediaCtx.restore();
    this.canvas.requestRenderAll();
  }

  /** Re-encode the picture at low JPEG quality — the deep-fried crunch. */
  async applyCrunch() {
    const amount = this.adjust.crunch;
    if (!this.media || this.media.kind === 'gif') { this.crunched = null; return; }
    if (!amount) { this.crunched = null; this.paintMedia(); return; }
    if (this.tainted) return; // reading pixels from a tainted canvas throws

    const scratch = document.createElement('canvas');
    const shrink = 1 - (amount / 100) * 0.55;
    scratch.width = Math.max(24, Math.round(this.media.width * shrink));
    scratch.height = Math.max(24, Math.round(this.media.height * shrink));
    scratch.getContext('2d').drawImage(this.media.image, 0, 0, scratch.width, scratch.height);

    const quality = clamp(0.42 - (amount / 100) * 0.4, 0.02, 0.42);
    const img = new Image();
    img.src = scratch.toDataURL('image/jpeg', quality);
    await img.decode().catch(() => {});
    this.crunched = img;
    this.paintMedia();
  }

  setAdjust(patch) {
    const needsCrunch = 'crunch' in patch && patch.crunch !== this.adjust.crunch;
    Object.assign(this.adjust, patch);
    if (needsCrunch) this.applyCrunch();
    else this.paintMedia();
    this.commit();
  }

  applyPreset(name) {
    this.filterPreset = name;
    this.adjust = { ...DEFAULT_ADJUST, ...(FILTER_PRESETS[name] || {}) };
    this.applyCrunch();
    this.paintMedia();
    this.commit();
    this.emit('adjust');
  }

  setPad(patch) {
    Object.assign(this.pad, patch);
    this.layout();
    this.paintMedia();
    this.fit();
    this.commit();
  }

  /* ---------------- animation ---------------- */

  play() {
    if (!this.isAnimated || this.playing) return;
    this.playing = true;
    const tick = () => {
      if (!this.playing || !this.isAnimated) return;
      const delay = this.media.frames[this.frameIndex]?.delay || 100;
      this.timer = setTimeout(() => {
        this.frameIndex = (this.frameIndex + 1) % this.media.frames.length;
        this.paintMedia();
        tick();
      }, delay);
    };
    this.paintMedia();
    tick();
    this.emit('play');
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.emit('play');
  }

  stop() {
    this.pause();
    this.frameIndex = 0;
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  /* ---------------- layers ---------------- */

  baseFontSize() {
    return clamp(Math.round(this.canvas.width * 0.085), 16, 140);
  }

  applyCase(obj) {
    if (obj?.mfUpper && obj.text && obj.text !== obj.text.toUpperCase()) {
      obj.set('text', obj.text.toUpperCase());
    }
  }

  addText(text = 'Your text', options = {}) {
    const size = options.fontSize || this.baseFontSize();
    const box = new fabric.Textbox(text, {
      width: this.canvas.width * 0.9,
      left: this.canvas.width / 2,
      top: this.canvas.height / 2,
      originX: 'center',
      originY: 'center',
      fontFamily: 'Impact',
      fontSize: size,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: Math.max(1, size * 0.08),
      strokeUniform: true,
      paintFirst: 'stroke',
      strokeLineJoin: 'round',
      strokeLineCap: 'round',
      textAlign: 'center',
      lineHeight: 1.05,
      mfKind: 'text',
      mfUpper: true,
      ...options,
    });
    this.applyCase(box);
    this.canvas.add(box);
    this.canvas.setActiveObject(box);
    this.canvas.requestRenderAll();
    this.emit('layers');
    return box;
  }

  addClassicText() {
    const size = this.baseFontSize();
    const padPx = this.canvas.height - this.media.height;
    const top = this.addText('Top text', {
      fontSize: size,
      top: padPx ? padPx / 2 : size * 0.85,
      originY: 'center',
      fill: padPx ? '#111111' : '#ffffff',
      stroke: padPx ? '' : '#000000',
      strokeWidth: padPx ? 0 : Math.max(1, size * 0.08),
      fontFamily: padPx ? 'Archivo' : 'Impact',
    });
    const bottom = this.addText('Bottom text', {
      fontSize: size,
      top: this.canvas.height - size * 0.85,
      originY: 'center',
    });
    this.canvas.setActiveObject(top);
    this.emit('layers');
    return [top, bottom];
  }

  addSticker(char) {
    const sticker = new fabric.Text(char, {
      left: this.canvas.width / 2,
      top: this.canvas.height / 2,
      originX: 'center',
      originY: 'center',
      fontSize: Math.round(this.canvas.width * 0.28),
      fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
      mfKind: 'sticker',
      mfName: char,
    });
    this.canvas.add(sticker);
    this.canvas.setActiveObject(sticker);
    this.emit('layers');
    return sticker;
  }

  addShape(kind) {
    const w = this.canvas.width;
    const common = {
      left: w / 2,
      top: this.canvas.height / 2,
      originX: 'center',
      originY: 'center',
      mfKind: 'shape',
      mfName: kind,
      strokeUniform: true,
    };
    let shape;
    if (kind === 'ellipse') {
      shape = new fabric.Ellipse({ ...common, rx: w * 0.22, ry: w * 0.15, fill: '', stroke: '#ff2d2d', strokeWidth: Math.max(3, w * 0.012) });
    } else if (kind === 'arrow') {
      const s = w * 0.4;
      shape = new fabric.Path(`M 0 ${s * 0.5} L ${s * 0.72} ${s * 0.5} L ${s * 0.72} ${s * 0.28} L ${s} ${s * 0.62} L ${s * 0.72} ${s * 0.96} L ${s * 0.72} ${s * 0.74} L 0 ${s * 0.74} Z`, {
        ...common, fill: '#ff2d2d', stroke: '#ffffff', strokeWidth: Math.max(2, w * 0.005),
      });
    } else if (kind === 'bar') {
      shape = new fabric.Rect({ ...common, width: w * 0.42, height: w * 0.09, fill: '#000000' });
    } else {
      shape = new fabric.Rect({ ...common, width: w * 0.4, height: w * 0.26, fill: '', stroke: '#ff2d2d', strokeWidth: Math.max(3, w * 0.012), rx: 4, ry: 4 });
    }
    this.canvas.add(shape);
    this.canvas.setActiveObject(shape);
    this.emit('layers');
    return shape;
  }

  async addImageLayer(src, name = 'image') {
    const { img } = await loadImage(src);
    const layer = new fabric.FabricImage(img, {
      left: this.canvas.width / 2,
      top: this.canvas.height / 2,
      originX: 'center',
      originY: 'center',
      mfKind: 'image',
      mfName: name,
    });
    const fit = (this.canvas.width * 0.5) / layer.width;
    layer.scale(Math.min(fit, 1));
    this.canvas.add(layer);
    this.canvas.setActiveObject(layer);
    this.emit('layers');
    return layer;
  }

  selected() {
    const active = this.canvas.getActiveObject();
    return active && active.type !== 'activeselection' ? active : null;
  }

  update(props, { commit = true } = {}) {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    obj.set(props);
    if (props.mfUpper !== undefined && obj.text) {
      obj.set('text', props.mfUpper ? obj.text.toUpperCase() : obj.text);
    }
    obj.setCoords();
    this.canvas.requestRenderAll();
    this.emit('layers');
    if (commit) this.commit();
  }

  removeSelected() {
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) return;
    this.canvas.remove(...objs);
    this.canvas.discardActiveObject();
    this.emit('layers');
  }

  async duplicateSelected() {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    const copy = await obj.clone(EXTRA_PROPS);
    copy.set({ left: obj.left + 24, top: obj.top + 24 });
    this.canvas.add(copy);
    this.canvas.setActiveObject(copy);
    this.emit('layers');
  }

  layers() {
    return this.canvas.getObjects().map((obj, i) => ({
      obj,
      index: i,
      kind: obj.mfKind || (obj.text != null ? 'text' : 'shape'),
      name: obj.mfKind === 'text' || obj.text != null
        ? (obj.text || 'Empty text').slice(0, 40)
        : obj.mfName || obj.type,
    }));
  }

  reorder(fromIndex, toIndex) {
    const objs = this.canvas.getObjects();
    const obj = objs[fromIndex];
    if (!obj) return;
    this.canvas.moveObjectTo(obj, toIndex);
    this.canvas.requestRenderAll();
    this.emit('layers');
    this.commit();
  }

  clearLayers() {
    this.canvas.remove(...this.canvas.getObjects());
    this.canvas.discardActiveObject();
    this.emit('layers');
  }

  /* ---------------- view ---------------- */

  fit() {
    if (!this.media || !this.stageEl) return;
    const styles = getComputedStyle(this.stageEl);
    const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight) + 30;
    const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom) + 30;
    const availableW = Math.max(160, this.stageEl.clientWidth - padX);
    const availableH = Math.max(160, this.stageEl.clientHeight - padY);
    const scale = Math.min(availableW / this.canvas.width, availableH / this.canvas.height, 1.4);
    this.displayScale = scale;
    this.canvas.setDimensions(
      { width: `${Math.round(this.canvas.width * scale)}px`, height: `${Math.round(this.canvas.height * scale)}px` },
      { cssOnly: true },
    );
    this.emit('view');
  }

  /* ---------------- history ---------------- */

  snapshot() {
    return JSON.stringify({
      objects: this.canvas.toObject(EXTRA_PROPS).objects,
      adjust: this.adjust,
      pad: this.pad,
      preset: this.filterPreset,
    });
  }

  commit() {
    if (this.restoring || !this.media) return;
    const snap = this.snapshot();
    if (this.past.at(-1) === snap) return;
    this.past.push(snap);
    if (this.past.length > 60) this.past.shift();
    this.future.length = 0;
    this.emit('history');
    this.emit('change');
  }

  async restore(snap) {
    const state = JSON.parse(snap);
    this.restoring = true;
    try {
      this.canvas.remove(...this.canvas.getObjects());
      const objects = await fabric.util.enlivenObjects(state.objects || []);
      objects.forEach((obj) => this.canvas.add(obj));
      this.adjust = { ...DEFAULT_ADJUST, ...state.adjust };
      this.pad = { ...this.pad, ...state.pad };
      this.filterPreset = state.preset || 'none';
      this.layout();
      await this.applyCrunch();
      this.paintMedia();
      this.fit();
    } finally {
      this.restoring = false;
    }
    this.emit('layers');
    this.emit('adjust');
    this.emit('selection');
  }

  get canUndo() { return this.past.length > 1; }
  get canRedo() { return this.future.length > 0; }

  async undo() {
    if (!this.canUndo) return;
    this.future.push(this.past.pop());
    await this.restore(this.past.at(-1));
    this.emit('history');
    this.emit('change');
  }

  async redo() {
    if (!this.canRedo) return;
    const snap = this.future.pop();
    this.past.push(snap);
    await this.restore(snap);
    this.emit('history');
    this.emit('change');
  }

  /* ---------------- serialisation ---------------- */

  toProject(name) {
    return {
      version: 2,
      name,
      media: this.media ? { src: this.media.src, kind: this.media.kind, name: this.media.name, source: this.media.source } : null,
      state: this.snapshot(),
    };
  }

  async fromProject(project) {
    if (project.media?.src) {
      await this.setMedia(project.media);
    }
    if (project.state) await this.restore(project.state);
    this.past = [this.snapshot()];
    this.future = [];
    this.emit('history');
  }

  /* ---------------- export ---------------- */

  render(scale = 1) {
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    return this.canvas.toCanvasElement(scale);
  }

  async toBlob({ type = 'image/png', quality = 0.92, scale = 1 } = {}) {
    const out = this.render(scale);
    return new Promise((resolve, reject) => {
      out.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode that image.'))),
        type,
        quality,
      );
    });
  }

  async toGifBlob({ scale = 1, onProgress } = {}) {
    if (!this.isAnimated) throw new Error('Load a GIF first — this one is a still image.');
    const wasPlaying = this.playing;
    this.pause();
    const startFrame = this.frameIndex;
    const frames = this.media.frames.slice(0, GIF_EXPORT_FRAMES);

    try {
      const probe = this.render(scale);
      return await encodeGif({
        width: probe.width,
        height: probe.height,
        count: frames.length,
        frameAt: (i) => {
          this.frameIndex = i;
          this.paintMedia();
          return { canvas: this.render(scale), delay: frames[i].delay };
        },
        onProgress,
      });
    } finally {
      this.frameIndex = startFrame;
      this.paintMedia();
      if (wasPlaying) this.play();
    }
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.pause();
    this.canvas.dispose();
  }
}

export { uid };
