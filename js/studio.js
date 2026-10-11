// The bench: one Fabric canvas, a media layer underneath it, and the history
// that lets you take any of it back.

import * as fabric from '../vendor/fabric.min.mjs';
import { decodeGif, isGifUrl, loadGif, encodeGif } from './media.js';
import { loadImage, clamp, uid, fetchBuffer, fileToDataUrl } from './util.js';

const MAX_IMAGE_EDGE = 1600;
const MAX_GIF_EDGE = 720;
const FRAME_PROPS = ['left', 'top', 'scaleX', 'scaleY', 'angle', 'opacity', 'visible', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fill', 'stroke', 'strokeWidth', 'strokeUniform', 'charSpacing', 'lineHeight', 'textAlign', 'flipX', 'flipY', 'width', 'height', 'rx', 'ry', 'skewX', 'skewY', 'originX', 'originY', 'mfUpper', 'shadow', 'mfRegion', 'mfMaskWidth'];
const emptyPad = () => ({ top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff', unit: 'px' });
const clone = (value) => JSON.parse(JSON.stringify(value));

const EXTRA_PROPS = [
  'mfKind', 'mfUpper', 'mfName', 'selectable', 'evented', 'objectCaching', 'subTargetCheck',
  'lockMovementX', 'lockMovementY', 'lockRotation', 'strokeUniform', 'paintFirst',
  'mfBase', 'mfOverrides', 'mfFrameIds', 'mfStart', 'mfEnd', 'mfCell', 'mfAnimation', 'mfRegion', 'mfMask', 'mfMaskWidth',
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
      fireRightClick: true,
      stopContextMenu: true,
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
    this.filterPreset = 'none';
    this.pad = emptyPad();
    this.crop = null;
    this.collage = null;
    this.scene = null;
    this.editMode = 'video';
    this.applyingFrame = false;
    this.filterPreset = 'none';
    this.frameAdjust = {};

    this.selectedFrameIds = new Set();
    this.frameIndex = 0;
    this.playing = false;
    this.timer = null;
    this.displayScale = 1;
    this.tainted = false;

    this.past = [];
    this.future = [];
    this.restoring = false;

    const bump = (e) => {
      if (e?.target?.type === 'path' && this.canvas.isDrawingMode) return;
      if (!this.restoring && !this.applyingFrame && e?.target) {
        if (e.target.type === 'activeselection') {
          const objects = this.canvas.getActiveObjects(); this.canvas.discardActiveObject();
          for (const obj of objects) this.rememberObject(obj);
        } else this.rememberObject(e.target);
      }
      this.commit();
    };
    this.canvas.on('object:added', bump);
    this.canvas.on('object:removed', () => this.commit());
    this.canvas.on('object:moving', (e) => this.snapObject(e.target));
    if (matchMedia('(pointer: coarse)').matches) fabric.InteractiveFabricObject.ownDefaults.touchCornerSize = 28;
    this.canvas.on('object:modified', (e) => { bump(e); this.applyFrame(); this.paintMedia(); });
    this.canvas.on('path:created', ({ path }) => {
      path.mfKind = this.maskDrawing ? 'mask' : 'drawing'; path.mfName = this.maskDrawing ? 'Brush mask' : 'Drawing';
      if (this.maskDrawing) {
        path.mfRegion = { ...this.maskDrawing }; path.mfMask = true; path.mfMaskWidth = path.strokeWidth;
        path.set({ stroke: 'rgba(0,0,0,0)', fill: '', objectCaching: false });
        delete path.mfBase; delete path.mfOverrides;
      }
      this.rememberObject(path); this.applyFrame(); this.paintMedia(); this.commit(); this.emit('layers');
    });
    this.canvas.on('text:changed', (e) => {
      this.applyCase(e.target);
      this.emit('layers');
      bump(e);
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
    let wantGif = kind === 'gif' || isGifUrl(src);
    const previous = this.media ? { width: this.canvas.width, height: this.canvas.height } : null;
    let media;
    let bytes;
    // Sniff links too: signed/CDN URLs often have no filename extension.
    if (wantGif || source === 'link') {
      bytes = await fetchBuffer(src);
      wantGif = String.fromCharCode(...new Uint8Array(bytes, 0, Math.min(6, bytes.byteLength))).startsWith('GIF8');
    }
    if (wantGif) {
      bytes ||= await fetchBuffer(src);
      const gif = decodeGif(bytes);
      const frames = gif.frames.map((frame, index) => ({ ...frame, id: uid(), sourceIndex: index }));
      media = { kind: 'gif', frames, originalFrames: frames.slice(), width: gif.width, height: gif.height };
      src = await fileToDataUrl(new Blob([bytes], { type: 'image/gif' }));
      this.tainted = false;
    } else {
      if (bytes) src = await fileToDataUrl(new Blob([bytes]));
      const { img, tainted } = await loadImage(src);
      this.tainted = tainted;
      media = { kind: 'image', image: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
      if (!tainted) {
        const embedded = document.createElement('canvas');
        const ratio = Math.min(1, MAX_IMAGE_EDGE / Math.max(media.width, media.height));
        embedded.width = Math.max(1, Math.round(media.width * ratio));
        embedded.height = Math.max(1, Math.round(media.height * ratio));
        embedded.getContext('2d').drawImage(img, 0, 0, embedded.width, embedded.height);
        src = embedded.toDataURL('image/png');
      }
    }
    this.setDrawing('none');
    this.stop();
    this.crop = null;
    this.collage = null;
    this.scene = null;
    this.frameAdjust = {};
    this.selectedFrameIds = new Set();
    this.past = [];
    this.future = [];
    // Old frame bindings cannot follow a different GIF.
    for (const obj of this.walkObjects()) {
      if (obj.mfBase) obj.set(obj.mfBase);
      delete obj.mfFrameIds;
      delete obj.mfOverrides;
      delete obj.mfStart;
      delete obj.mfEnd;
      obj.mfBase = this.objectProps(obj);
    }
    const maxEdge = media.kind === 'gif' ? MAX_GIF_EDGE : MAX_IMAGE_EDGE;
    const scale = Math.min(1, maxEdge / Math.max(media.width, media.height));
    media.width = Math.round(media.width * scale);
    media.height = Math.round(media.height * scale);

    this.media = { ...media, name, source, src };
    this.frameIndex = 0;
    this.selectedFrameIds = new Set(media.frames?.length ? [media.frames[0].id] : []);
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
    this.applyFrame();
    this.paintMedia();
    this.fit();
    this.commit();
    this.emit('media');
    this.emit('timeline');
    if (this.isAnimated) this.play();
    return this.media;
  }

  /** Keep existing layers where they were, proportionally, on a new picture. */
  rescaleLayers(previous) {
    const fx = this.canvas.width / previous.width;
    const fy = this.canvas.height / previous.height;
    if (!isFinite(fx) || !isFinite(fy) || (fx === 1 && fy === 1)) return;
    const f = Math.min(fx, fy);
    const resize = (props) => {
      const out = { ...props };
      for (const [key, ratio] of [['left', fx], ['top', fy], ['scaleX', f], ['scaleY', f]]) if (out[key] != null) out[key] *= ratio;
      return out;
    };
    for (const obj of this.canvas.getObjects()) {
      obj.mfBase = resize(obj.mfBase || this.objectProps(obj));
      for (const [id, props] of Object.entries(obj.mfOverrides || {})) obj.mfOverrides[id] = resize(props);
      if (obj.mfAnimation?.kind === 'poses') {
        for (const role of ['start', 'end']) if (obj.mfAnimation[role]) obj.mfAnimation[role] = resize(obj.mfAnimation[role]);
      }
      obj.set(obj.mfBase); obj._motion = null; obj.setCoords();
    }
    this.applyFrame();
    this.canvas.requestRenderAll();
    this.emit('layers');
  }

  get contentRect() {
    return this.crop || { x: 0, y: 0, width: this.media?.width || 1, height: this.media?.height || 1 };
  }

  get paddingPixels() {
    const height = this.contentRect.height;
    return Object.fromEntries(['top', 'right', 'bottom', 'left'].map((key) => [key,
      Math.round((Number(this.pad[key]) || 0) * (this.pad.unit === 'percent' ? height / 100 : 1)),
    ]));
  }

  layout() {
    if (!this.media) return;
    const rect = this.contentRect;
    const pad = this.paddingPixels;
    const width = this.scene?.width || rect.width, height = this.scene?.height || rect.height;
    this.mediaCanvas.width = width; this.mediaCanvas.height = height;
    this.canvas.setDimensions({ width: width + pad.left + pad.right, height: height + pad.top + pad.bottom });
    this.canvas.backgroundColor = this.pad.color;
    this.mediaImage.set({ top: pad.top, left: pad.left, width, height });
    this.canvas.backgroundImage = this.mediaImage;
    this.canvas.requestRenderAll();
  }

  setCrop(rect) {
    if (!this.media) return;
    if (rect) {
      const x = clamp(Math.round(Number(rect.x) || 0), 0, this.media.width - 1);
      const y = clamp(Math.round(Number(rect.y) || 0), 0, this.media.height - 1);
      this.crop = { x, y, width: clamp(Math.round(Number(rect.width) || 1), 1, this.media.width - x), height: clamp(Math.round(Number(rect.height) || 1), 1, this.media.height - y) };
    } else this.crop = null;
    this.layout();
    this.paintMedia();
    this.fit();
    this.commit();
    this.emit('adjust');
  }

  get effectiveAdjust() {
    return { ...this.adjust, ...this.frameAdjust?.[this.media?.frames?.[this.frameIndex]?.id] };
  }

  previewAdjust(patch) {
    if (this.isAnimated && this.editMode === 'frame') {
      const id = this.media.frames[this.frameIndex].id;
      for (const id of this.editingFrameIds()) this.frameAdjust[id] = { ...this.frameAdjust[id], ...patch };
    } else {
      Object.assign(this.adjust, patch);
      for (const override of Object.values(this.frameAdjust)) for (const key of Object.keys(patch)) delete override[key];
    }
    this.paintMedia();
  }

  filterString() {
    const a = this.effectiveAdjust;
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
    const rect = this.contentRect;
    const sx = src.width / this.media.width;
    const sy = src.height / this.media.height;
    const place = this.imagePlacement;
    if (this.scene) { this.mediaCtx.filter = 'none'; this.mediaCtx.fillStyle = this.scene.color || '#ffffff'; this.mediaCtx.fillRect(0, 0, width, height); this.mediaCtx.filter = this.filterString(); }
    this.mediaCtx.drawImage(src, rect.x * sx, rect.y * sy, rect.width * sx, rect.height * sy, place.x, place.y, place.width, place.height);
    this.mediaCtx.restore();
    this.paintRegions();
    this.canvas.requestRenderAll();
  }

  /** Re-encode the picture at low JPEG quality — the deep-fried crunch. */
  async applyCrunch() {
    const generation = this.crunchGeneration = (this.crunchGeneration || 0) + 1;
    const media = this.media;
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
    if (generation !== this.crunchGeneration || media !== this.media) return;
    this.crunched = img;
    this.paintMedia();
  }

  setAdjust(patch) {
    const needsCrunch = 'crunch' in patch && patch.crunch !== this.adjust.crunch;
    this.previewAdjust(patch);
    if (needsCrunch) this.applyCrunch();
    this.commit();
  }

  applyPreset(name) {
    this.filterPreset = name;
    this.previewAdjust({ ...DEFAULT_ADJUST, ...(FILTER_PRESETS[name] || {}) });
    this.applyCrunch();
    this.paintMedia();
    this.commit();
    this.emit('adjust');
  }

  setPad(patch) {
    Object.assign(this.pad, patch);
    for (const key of ['top', 'right', 'bottom', 'left']) this.pad[key] = clamp(Number(this.pad[key]) || 0, 0, 2000);
    this.layout();
    this.paintMedia();
    this.fit();
    this.commit();
    this.emit('adjust');
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
        this.applyFrame();
        this.paintMedia();
        this.emit('frame');
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

  get duration() { return this.isAnimated ? this.media.frames.reduce((sum, f) => sum + f.delay, 0) : 0; }
  get currentTime() { return this.isAnimated ? this.media.frames.slice(0, this.frameIndex).reduce((sum, f) => sum + f.delay, 0) : 0; }

  setMode(mode) {
    this.pause();
    this.editMode = mode === 'frame' ? 'frame' : 'video';
    this.emit('frame');
    this.emit('adjust');
  }

  seek(index, pause = true, preserveSelection = false) {
    if (!this.isAnimated) return;
    this.frameIndex = clamp(Math.round(index), 0, this.media.frames.length - 1);
    if (pause) this.pause();
    if (!preserveSelection) { this.selectedFrameIds = new Set([this.media.frames[this.frameIndex].id]); this.selectionAnchor = this.frameIndex; }
    this.applyFrame();
    this.paintMedia();
    this.emit('frame');
    this.emit('adjust');
    this.emit('selection');
  }

  frameAtTime(ms) {
    let time = 0;
    const index = this.media.frames.findIndex((f) => { time += f.delay; return time > ms; });
    return index < 0 ? this.media.frames.length - 1 : index;
  }

  seekTime(ms) { this.seek(this.frameAtTime(ms)); }

  objectProps(obj) {
    return Object.fromEntries(FRAME_PROPS.filter((key) => obj[key] !== undefined && !(key === 'height' && obj.text != null)).map((key) => [key, clone(obj[key])]));
  }

  rememberObject(obj, changedKeys) {
    if (this.applyingFrame || this.restoring || obj.type === 'activeselection') return;
    const props = this.objectProps(obj);
    // Motion is a transient transform; store the user's edits in base coordinates.
    const motion = obj._motion;
    if (motion) {
      props.left -= motion.x; props.top -= motion.y;
      props.angle -= motion.angle || 0;
      props.scaleX /= motion.scale; props.scaleY /= motion.scaleY ?? motion.scale;
      props.opacity = motion.baseOpacity != null ? motion.baseOpacity + props.opacity - motion.renderedOpacity : motion.opacity > 0 ? props.opacity / motion.opacity : obj.mfBase?.opacity ?? 1;
    }
    if (!obj.mfBase) {
      obj.mfBase = props;
      if (this.isAnimated && this.editMode === 'frame') obj.mfFrameIds = this.editingFrameIds();
    } else if (this.isAnimated && this.editMode === 'frame') {
      const id = this.media.frames[this.frameIndex].id;
      const before = { ...obj.mfBase, ...obj.mfOverrides?.[id] };
      const changed = changedKeys || FRAME_PROPS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(props[key]));
      obj.mfOverrides ||= {};
      for (const target of this.editingFrameIds()) {
        obj.mfOverrides[target] ||= {};
        for (const key of changed) if (FRAME_PROPS.includes(key) && props[key] !== undefined) obj.mfOverrides[target][key] = clone(props[key]);
      }
    } else {
      // Apply only changed properties, keeping unrelated per-frame edits.
      const id = this.media?.frames?.[this.frameIndex]?.id;
      const before = { ...obj.mfBase, ...obj.mfOverrides?.[id] };
      const changed = changedKeys || FRAME_PROPS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(props[key]));
      for (const key of changed.filter((key) => FRAME_PROPS.includes(key) && props[key] !== undefined)) {
        obj.mfBase[key] = props[key];
        for (const override of Object.values(obj.mfOverrides || {})) delete override[key];
      }
    }
  }

  applyFrame() {
    this.applyingFrame = true;
    try {
      const id = this.media?.frames?.[this.frameIndex]?.id;
      if (this.canvas.getActiveObject()?.type === 'activeselection') this.canvas.discardActiveObject();
      for (const obj of this.walkObjects()) {
        if (obj.mfBase) obj.set({ ...obj.mfBase, ...obj.mfOverrides?.[id] });
        const inRange = (obj.mfStart == null || this.frameIndex >= obj.mfStart) && (obj.mfEnd == null || this.frameIndex <= obj.mfEnd);
        if (this.isAnimated && (!inRange || (obj.mfFrameIds && !obj.mfFrameIds.includes(id)))) obj.set('visible', false);
        this.applyMotion(obj);
        obj.setCoords();
      }
      this.canvas.requestRenderAll();
    } finally { this.applyingFrame = false; }
  }

  editFrames(action, start = this.frameIndex, end = start, value) {
    if (!this.isAnimated) return;
    this.pause();
    const frames = this.media.frames;
    start = clamp(Math.round(start), 0, frames.length - 1);
    end = clamp(Math.round(end), start, frames.length - 1);
    if (action === 'delay') {
      for (const frame of frames.slice(start, end + 1)) frame.delay = clamp(Number(value) || 100, 10, 10000);
    } else if (action === 'fps') {
      const fps = clamp(Number(value) || 24, 1, 100);
      frames.forEach((frame) => { frame.delay = 1000 / fps; });
    } else if (action === 'reverse') frames.reverse();
    else if (action === 'duplicate') {
      if (frames.length >= 1200) throw new Error('A project supports at most 1200 frames.');
      const original = frames[start];
      const copy = { ...original, id: uid() };
      frames.splice(start + 1, 0, copy);
      if (this.frameAdjust[original.id]) this.frameAdjust[copy.id] = clone(this.frameAdjust[original.id]);
      for (const obj of this.walkObjects()) {
        if (obj.mfFrameIds?.includes(original.id)) obj.mfFrameIds.push(copy.id);
        if (obj.mfOverrides?.[original.id]) obj.mfOverrides[copy.id] = clone(obj.mfOverrides[original.id]);
      }
    } else if (action === 'delete' && end - start + 1 < frames.length) frames.splice(start, end - start + 1);
    else if (action === 'trim') this.media.frames = frames.slice(start, end + 1);
    else if (action === 'move') {
      const target = clamp(Number(value), 0, frames.length - 1);
      const [frame] = frames.splice(start, 1);
      frames.splice(target, 0, frame);
      this.frameIndex = target;
    }
    // Frame range boundaries follow the frame IDs through reorders/trim.
    const order = this.media.frames;
    for (const obj of this.walkObjects()) {
      if (obj.mfFrameIds) obj.mfFrameIds = obj.mfFrameIds.filter((id) => order.some((f) => f.id === id));
    }
    this.selectedFrameIds = new Set([...this.selectedFrameIds].filter((id) => order.some((f) => f.id === id)));
    this.seek(Math.min(this.frameIndex, order.length - 1), true, true);
    this.commit();
    this.emit('timeline');
  }

  setLayerRange(start, end) {
    const obj = this.selected();
    if (!obj || !this.isAnimated) return;
    const frames = this.media.frames;
    start = clamp(Number(start), 0, frames.length - 1);
    end = clamp(Number(end), start, frames.length - 1);
    obj.mfFrameIds = frames.slice(start, end + 1).map((f) => f.id);
    delete obj.mfStart;
    delete obj.mfEnd;
    this.applyFrame();
    this.commit();
    this.emit('layers');
  }

  reset() {
    this.setDrawing('none');
    this.editMode = 'video';
    this.filterPreset = 'none';
    this.tainted = false;
    this.stop();
    this.restoring = true;
    this.canvas.clear();
    this.restoring = false;
    this.media = null;
    this.mediaImage = null;
    this.crunched = null;
    this.adjust = { ...DEFAULT_ADJUST };
    this.filterPreset = 'none';
    this.pad = emptyPad();
    this.crop = null;
    this.collage = null;
    this.scene = null;
    this.frameAdjust = {};
    this.selectedFrameIds = new Set();
    this.past = [];
    this.future = [];
    this.displayScale = 1;
    this.pan = { x: 0, y: 0 };
    this.stageEl.querySelector('.bench').style.transform = '';
    for (const event of ['media', 'layers', 'selection', 'history', 'timeline', 'adjust', 'view']) this.emit(event);
  }

  alignSelected(axis) {
    const obj = this.selected();
    if (!obj) return;
    const bounds = obj.getBoundingRect();
    const patch = {};
    if (axis === 'x' || axis === 'both') patch.left = obj.left + (this.canvas.width - bounds.width) / 2 - bounds.left;
    if (axis === 'y' || axis === 'both') patch.top = obj.top + (this.canvas.height - bounds.height) / 2 - bounds.top;
    this.update(patch);
  }

  fitText() {
    const obj = this.selected();
    if (!obj || obj.text == null) return;
    const maxHeight = Math.max(20, this.canvas.height * 0.25);
    let size = Math.min(260, Math.round(this.canvas.width * 0.12));
    obj.set({ fontSize: size });
    while (size > 8 && obj.height * obj.scaleY > maxHeight) obj.set({ fontSize: --size });
    this.update({ fontSize: size });
  }

  snapObject(obj) {
    if (!obj || !this.snapping) return;
    obj.setCoords();
    const b = obj.getBoundingRect(), threshold = 7 / this.displayScale;
    const xs = [0, this.canvas.width / 2, this.canvas.width], ys = [0, this.canvas.height / 2, this.canvas.height];
    const selected = new Set(this.canvas.getActiveObjects());
    for (const other of this.canvas.getObjects()) {
      if (other === obj || selected.has(other) || !other.visible) continue;
      const o = other.getBoundingRect(); xs.push(o.left, o.left + o.width / 2, o.left + o.width); ys.push(o.top, o.top + o.height / 2, o.top + o.height);
    }
    const closest = (targets, anchors) => {
      let best = null; for (const target of targets) for (const anchor of anchors) {
        const delta = target - anchor; if (Math.abs(delta) < threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target };
      } return best;
    };
    const x = closest(xs, [b.left, b.left + b.width / 2, b.left + b.width]), y = closest(ys, [b.top, b.top + b.height / 2, b.top + b.height]);
    if (x) obj.left += x.delta; if (y) obj.top += y.delta; obj.setCoords();
    this.snapGuides = { x: x?.target, y: y?.target }; this.emit('guides');
  }

  zoom(scale) {
    if (!this.media) return;
    this.displayScale = clamp(scale, 0.1, 5);
    this.canvas.setDimensions({ width: `${Math.round(this.canvas.width * this.displayScale)}px`, height: `${Math.round(this.canvas.height * this.displayScale)}px` }, { cssOnly: true });
    this.emit('view');
  }

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
    const padPx = this.paddingPixels.top;
    const wasRestoring = this.restoring;
    this.restoring = true;
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
    this.restoring = wasRestoring;
    for (const obj of [top, bottom]) this.rememberObject(obj);
    this.commit();
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
    } else if (kind === 'bubble') {
      shape = new fabric.Path('M 0 0 L 240 0 Q 260 0 260 20 L 260 110 Q 260 130 240 130 L 100 130 L 60 170 L 65 130 L 20 130 Q 0 130 0 110 L 0 20 Q 0 0 20 0 Z', { ...common, fill: '#ffffff', stroke: '#111111', strokeWidth: 3, scaleX: w * 0.5 / 260, scaleY: w * 0.5 / 260 });
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
    if (this.isAnimated) this.pause();
    obj.set(props);
    if (props.mfUpper !== undefined && obj.text) {
      obj.set('text', props.mfUpper ? obj.text.toUpperCase() : obj.text);
    }
    this.rememberObject(obj, Object.keys(props).concat('mfUpper' in props ? ['text'] : []));
    this.applyFrame();
    this.paintMedia();
    obj.setCoords();
    this.canvas.requestRenderAll();
    this.emit('layers');
    if (commit) this.commit();
  }

  removeSelected() {
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) return;
    if (this.isAnimated && this.editMode === 'frame') {
      for (const obj of objs) { obj.set('visible', false); this.rememberObject(obj); }
      this.commit();
    } else {
      const wasRestoring = this.restoring;
      this.restoring = true;
      this.canvas.remove(...objs);
      this.restoring = wasRestoring;
      this.commit();
    }
    this.canvas.discardActiveObject();
    this.emit('layers');
  }

  async duplicateSelected() {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    const copy = await obj.clone(EXTRA_PROPS);
    const base = { ...obj.mfBase, ...obj.mfOverrides?.[this.media?.frames?.[this.frameIndex]?.id] };
    copy.set({ ...base, left: (base.left ?? obj.left) + 24, top: (base.top ?? obj.top) + 24 });
    delete copy.mfBase;
    delete copy.mfOverrides;
    delete copy.mfFrameIds;
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
    const wasRestoring = this.restoring;
    this.restoring = true;
    this.canvas.remove(...this.canvas.getObjects());
    this.restoring = wasRestoring;
    this.commit();
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
    this.pan = { x: 0, y: 0 };
    this.stageEl.querySelector('.bench').style.transform = '';
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
      crop: this.crop,
      collage: this.collage,
      scene: this.scene,
      frameAdjust: this.frameAdjust,
      timeline: this.isAnimated ? this.media.frames.map(({ id, sourceIndex, delay }) => ({ id, sourceIndex, delay })) : null,
    });
  }

  commit() {
    if (this.restoring || !this.media || this.applyingFrame) return;
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
    this.pause();
    this.restoring = true;
    try {
      this.canvas.remove(...this.canvas.getObjects());
      const objects = await fabric.util.enlivenObjects(state.objects || []);
      objects.forEach((obj) => this.canvas.add(obj));
      this.adjust = { ...DEFAULT_ADJUST, ...state.adjust };
      this.pad = { ...emptyPad(), ...state.pad, unit: state.pad?.unit || 'percent' };
      this.crop = state.crop || null;
      this.collage = state.collage || null;
      this.scene = state.scene ? { width: clamp(Number(state.scene.width) || 32, 32, 1600), height: clamp(Number(state.scene.height) || 32, 32, 1600), mode: state.scene.mode === 'cover' ? 'cover' : 'fit', color: state.scene.color || '#ffffff' } : null;
      this.frameAdjust = state.frameAdjust || {};
      if (state.timeline && this.isAnimated) {
        if (!state.timeline.length || state.timeline.some((f) => !this.media.originalFrames[f.sourceIndex])) throw new Error('The project refers to a missing GIF frame.');
        this.media.frames = state.timeline.map((f) => ({ ...f, canvas: this.media.originalFrames[f.sourceIndex]?.canvas })).filter((f) => f.canvas);
        this.frameIndex = Math.min(this.frameIndex, this.media.frames.length - 1);
      }
      for (const obj of this.walkObjects()) if (!obj.mfBase) obj.mfBase = this.objectProps(obj);
      this.selectedFrameIds = new Set(this.isAnimated ? [this.media.frames[this.frameIndex].id] : []);
      this.applyFrame();
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
    this.emit('timeline');
  }

  get canUndo() { return !this.historyBusy && this.past.length > 1; }
  get canRedo() { return !this.historyBusy && this.future.length > 0; }

  async undo() {
    if (!this.canUndo) return;
    this.historyBusy = true;
    this.emit('history');
    try {
      this.future.push(this.past.pop());
      await this.restore(this.past.at(-1));
      this.emit('change');
    } finally { this.historyBusy = false; this.emit('history'); }
  }

  async redo() {
    if (!this.canRedo) return;
    this.historyBusy = true;
    this.emit('history');
    try {
      const snap = this.future.pop();
      this.past.push(snap);
      await this.restore(snap);
      this.emit('change');
    } finally { this.historyBusy = false; this.emit('history'); }
  }

  /* ---------------- serialisation ---------------- */

  toProject(name) {
    return {
      version: 3,
      name,
      media: this.media ? { src: this.media.src, kind: this.media.kind, name: this.media.name, source: this.media.source, generatedFrames: this.media.generatedFrames || [] } : null,
      state: this.snapshot(),
    };
  }

  async fromProject(project) {
    if (project.media?.src) {
      await this.setMedia(project.media);
      if (this.isAnimated && project.media.generatedFrames?.length) {
        if (!Array.isArray(project.media.generatedFrames) || project.media.generatedFrames.length > 1200) throw new Error('Invalid generated GIF frames.');
        let bytes = this.media.originalFrames.reduce((n, f) => n + f.canvas.width * f.canvas.height * 4, 0);
        for (const src of project.media.generatedFrames) {
          if (typeof src !== 'string' || !src.startsWith('data:image/png')) throw new Error('Invalid generated GIF frame source.');
          const { img } = await loadImage(src); bytes += img.width * img.height * 4;
          if (bytes > 192 * 1024 * 1024) throw new Error('Generated GIF frames exceed the memory budget.');
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d').drawImage(img, 0, 0);
          this.media.originalFrames.push({ canvas });
        }
        this.media.generatedFrames = project.media.generatedFrames.slice();
      }
    }
    if (project.state) await this.restore(project.state);
    this.past = [this.snapshot()];
    this.future = [];
    this.emit('history');
  }

  /* ---------------- export ---------------- */

  render(scale = 1) {
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

  async toGifBlob({ scale = 1, onProgress, quality = 8, colors = 256, dither = false, drop = 1, merge = false, repeat = 0, signal } = {}) {
    if (!this.isAnimated) throw new Error('Load a GIF first.');
    const wasPlaying = this.playing;
    this.pause();
    const startFrame = this.frameIndex;
    const media = this.media;
    const frames = media.frames;
    let encodedTime = 0, desiredTime = 0;
    drop = clamp(Math.round(drop), 1, 10);
    const plan = [];
    let previousPixels;
    try {
      for (let i = 0; i < frames.length; i += drop) {
        const delay = frames.slice(i, i + drop).reduce((n, f) => n + f.delay, 0);
        let same = false;
        if (merge) {
          this.frameIndex = i; this.applyFrame(); this.paintMedia();
          const rendered = this.render(scale);
          const pixels = rendered.getContext('2d').getImageData(0, 0, rendered.width, rendered.height).data;
          same = !!previousPixels && pixels.length === previousPixels.length && pixels.every((v, j) => v === previousPixels[j]);
          previousPixels = pixels;
          onProgress?.(0.1 * (i + 1) / frames.length);
        }
        if (same && plan.length) plan.at(-1).delay += delay;
        else plan.push({ index: i, delay });
      }
      // GIF frame delays are unsigned 16-bit centiseconds.
      for (let i = 0; i < plan.length; i++) {
        if (plan[i].delay > 655350) {
          const remaining = plan[i].delay - 655350;
          plan[i].delay = 655350; plan.splice(i + 1, 0, { index: plan[i].index, delay: remaining });
        }
      }
      const probe = this.render(scale);
      return await encodeGif({
        width: probe.width, height: probe.height, count: plan.length, quality, colors, dither, repeat, signal,
        frameAt: (i) => {
          this.frameIndex = plan[i].index; this.applyFrame(); this.paintMedia();
          desiredTime += plan[i].delay;
          const nextTime = Math.round(desiredTime / 10) * 10;
          const delay = Math.max(10, nextTime - encodedTime); encodedTime += delay;
          return { canvas: this.render(scale), delay };
        },
        onProgress: (p) => onProgress?.(merge ? 0.1 + p * 0.9 : p),
      });
    } finally {
      if (this.media === media) {
        this.frameIndex = Math.min(startFrame, this.media.frames.length - 1); this.applyFrame(); this.paintMedia(); this.emit('frame');
        if (wasPlaying) this.play();
      }
    }
  }

  editingFrameIds() {
    const current = this.media?.frames?.[this.frameIndex]?.id;
    return this.selectedFrameIds.size ? [...this.selectedFrameIds] : current ? [current] : [];
  }

  selectFrames(index, { shiftKey = false, ctrlKey = false, metaKey = false } = {}) {
    if (!this.isAnimated) return;
    const frames = this.media.frames;
    if (shiftKey) {
      const anchor = Math.min(this.selectionAnchor ?? this.frameIndex, frames.length - 1);
      if (!ctrlKey && !metaKey) this.selectedFrameIds.clear();
      frames.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).forEach((f) => this.selectedFrameIds.add(f.id));
    } else if (ctrlKey || metaKey) {
      const id = frames[index].id;
      this.selectedFrameIds.has(id) ? this.selectedFrameIds.delete(id) : this.selectedFrameIds.add(id);
      this.selectionAnchor = index;
    } else {
      this.selectedFrameIds = new Set([frames[index].id]); this.selectionAnchor = index;
    }
    this.seek(index, true, true);
  }

  copyFrameEdits() {
    if (!this.isAnimated) return;
    const id = this.media.frames[this.frameIndex].id;
    for (const target of this.editingFrameIds()) {
      this.frameAdjust[target] = clone(this.frameAdjust[id] || {});
      for (const obj of this.canvas.getObjects()) {
        obj.mfOverrides ||= {}; obj.mfOverrides[target] = clone(obj.mfOverrides[id] || {});
        if (obj.mfFrameIds?.includes(id) && !obj.mfFrameIds.includes(target)) obj.mfFrameIds.push(target);
      }
    }
    this.applyFrame(); this.paintMedia(); this.commit(); this.emit('layers');
  }

  batchFrames(action, value) {
    if (!this.isAnimated) return;
    this.pause();
    const ids = this.editingFrameIds();
    if (action === 'delete') {
      if (ids.length >= this.media.frames.length) throw new Error('Keep at least one frame.');
      this.media.frames = this.media.frames.filter((f) => !ids.includes(f.id));
      this.selectedFrameIds.clear(); this.seek(Math.min(this.frameIndex, this.media.frames.length - 1));
    } else if (action === 'delay') {
      this.media.frames.filter((f) => ids.includes(f.id)).forEach((f) => { f.delay = clamp(Number(value) || 100, 10, 10000); });
    }
    this.commit(); this.emit('timeline');
  }

  setAnimation(config) {
    const obj = this.selected(); if (!obj) throw new Error('Select a text, sticker or shape layer first.');
    obj.mfAnimation = config?.kind === 'none' ? null : config;
    this.applyFrame(); this.commit(); this.emit('layers'); this.emit('frame');
  }

  applyMotion(obj) {
    obj._motion = null;
    const a = obj.mfAnimation;
    if (!a || !this.isAnimated) return;
    const ids = obj.mfFrameIds;
    let begin = 0, finish = this.duration, at = 0;
    if (ids) {
      begin = Infinity; finish = 0;
      for (const f of this.media.frames) { if (ids.includes(f.id)) { begin = Math.min(begin, at); finish = at + f.delay; } at += f.delay; }
    }
    const t = Math.max(0, this.currentTime - begin);
    const span = Math.max(1, Math.min(Number(a.duration) || 500, finish - begin));
    const p = clamp(t / span, 0, 1), strength = clamp(Number(a.strength) || 20, 1, 100);
    const m = { x: 0, y: 0, scale: 1, opacity: 1, angle: 0, baseOpacity: obj.opacity };
    if (a.kind === 'fade') m.opacity = p;
    if (a.kind === 'slide') m.x = -strength * (1 - p);
    if (a.kind === 'shake') m.x = t < span ? Math.sin(t / 35) * strength * (1 - p) : 0;
    if (a.kind === 'zoom') m.scale = 1 + strength / 100 * p;
    if (a.kind === 'poses') {
      if (!a.start || !a.end) return;
      const lastIndex = this.media.frames.findLastIndex((f) => !ids || ids.includes(f.id));
      const lastDelay = this.media.frames[lastIndex]?.delay || 0;
      const duration = a.duration > 0 ? a.duration : Math.max(1, finish - begin - lastDelay);
      let progress = clamp(t / duration, 0, 1);
      if (a.easing === 'ease-in') progress *= progress;
      else if (a.easing === 'ease-out') progress = 1 - (1 - progress) ** 2;
      else if (a.easing === 'smooth') progress = progress * progress * (3 - 2 * progress);
      const lerp = (key) => a.start[key] + (a.end[key] - a.start[key]) * progress;
      m.x = lerp('left') - obj.left; m.y = lerp('top') - obj.top; m.angle = lerp('angle') - obj.angle;
      const sx = lerp('scaleX'), sy = lerp('scaleY'), opacity = lerp('opacity');
      m.scale = sx / (obj.scaleX || 1); m.scaleY = sy / (obj.scaleY || 1);
      m.renderedOpacity = opacity;
      obj.set({ left: lerp('left'), top: lerp('top'), angle: lerp('angle'), scaleX: sx, scaleY: sy, opacity });
    } else {
      obj.set({ left: obj.left + m.x, top: obj.top + m.y, scaleX: obj.scaleX * m.scale, scaleY: obj.scaleY * m.scale, opacity: obj.opacity * m.opacity });
      m.renderedOpacity = obj.opacity;
    }
    obj._motion = m;
  }

  addRegion(kind = 'pixelate', strength = 12) {
    const obj = new fabric.Rect({ left: this.canvas.width * 0.25, top: this.canvas.height * 0.25, width: this.canvas.width * 0.5, height: this.canvas.height * 0.5, fill: '', strokeWidth: 0, mfKind: 'region', mfName: kind === 'blur' ? 'Regional blur' : 'Regional pixelation', mfRegion: { kind, strength }, lockRotation: true });
    this.canvas.add(obj); this.canvas.setActiveObject(obj); this.paintMedia(); this.emit('layers'); return obj;
  }

  paintRegions() {
    const ctx = this.mediaCtx, pad = this.paddingPixels;
    for (const obj of this.walkObjects()) {
      if (!obj.mfRegion || !this.effectiveVisible(obj)) continue;
      const b = obj.getBoundingRect();
      const x = clamp(Math.round(b.left - pad.left), 0, this.mediaCanvas.width), y = clamp(Math.round(b.top - pad.top), 0, this.mediaCanvas.height);
      const w = clamp(Math.round(b.left - pad.left + b.width), 0, this.mediaCanvas.width) - x;
      const h = clamp(Math.round(b.top - pad.top + b.height), 0, this.mediaCanvas.height) - y;
      if (w < 1 || h < 1) continue;
      const scratch = document.createElement('canvas');
      const strength = clamp(Number(obj.mfRegion.strength) || 12, 1, 100);
      const pixel = obj.mfRegion.kind === 'pixelate';
      scratch.width = pixel ? Math.max(1, Math.ceil(w / strength)) : w;
      scratch.height = pixel ? Math.max(1, Math.ceil(h / strength)) : h;
      scratch.getContext('2d').drawImage(this.mediaCanvas, x, y, w, h, 0, 0, scratch.width, scratch.height);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      const filter = obj.mfRegion.kind === 'filter' ? `saturate(${obj.mfRegion.saturate ?? 0}%) contrast(${obj.mfRegion.contrast ?? 100}%)` : pixel ? 'none' : `blur(${strength}px)`;
      if (obj.mfMask) {
        const processed = document.createElement('canvas'); processed.width = this.mediaCanvas.width; processed.height = this.mediaCanvas.height;
        const pc = processed.getContext('2d'); pc.filter = filter; pc.imageSmoothingEnabled = !pixel;
        pc.drawImage(scratch, 0, 0, scratch.width, scratch.height, x, y, w, h); pc.filter = 'none';
        const mask = document.createElement('canvas'); mask.width = processed.width; mask.height = processed.height;
        const mc = mask.getContext('2d'); mc.translate(-pad.left, -pad.top);
        if (obj.group) mc.transform(...obj.group.calcTransformMatrix());
        const saved = { stroke: obj.stroke, fill: obj.fill, opacity: obj.opacity, strokeWidth: obj.strokeWidth, objectCaching: obj.objectCaching };
        obj.set({ stroke: '#ffffff', fill: '', opacity: 1, strokeWidth: obj.mfMaskWidth || obj.strokeWidth, objectCaching: false });
        try { obj.render(mc); } finally { obj.set(saved); }
        pc.globalCompositeOperation = 'destination-in'; pc.drawImage(mask, 0, 0);
        ctx.globalAlpha = this.effectiveOpacity(obj); ctx.drawImage(processed, 0, 0);
      } else {
        ctx.filter = filter; ctx.imageSmoothingEnabled = !pixel; ctx.globalAlpha = this.effectiveOpacity(obj);
        ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, x, y, w, h);
      }
      ctx.restore();
    }
  }

  setDrawing(kind, color = '#ff2d2d', width = 8) {
    this.pause(); this.maskDrawing = null; this.canvas.isDrawingMode = kind !== 'none';
    if (kind !== 'none') {
      this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
      this.canvas.freeDrawingBrush.color = kind === 'highlight' ? color + '66' : color;
      this.canvas.freeDrawingBrush.width = clamp(Number(width) || 8, 1, 100);
    }
  }

  *walkObjects(objects = this.canvas.getObjects()) {
    for (const obj of objects) { yield obj; if (obj.type === 'group') yield* this.walkObjects(obj.getObjects()); }
  }

  effectiveVisible(obj) {
    for (let node = obj; node; node = node.group) if (!node.visible) return false;
    return true;
  }

  effectiveOpacity(obj) {
    let opacity = 1; for (let node = obj; node; node = node.group) opacity *= node.opacity;
    return opacity;
  }

  get imagePlacement() {
    const rect = this.contentRect, width = this.mediaCanvas.width, height = this.mediaCanvas.height;
    if (!this.scene) return { x: 0, y: 0, width, height };
    const scale = this.scene.mode === 'cover' ? Math.max(width / rect.width, height / rect.height) : Math.min(width / rect.width, height / rect.height);
    const w = rect.width * scale, h = rect.height * scale;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
  }

  setScene(config, resizeLayers = true) {
    if (!this.hasMedia) throw new Error('Load a picture first.');
    this.pause(); this.canvas.discardActiveObject();
    const previous = { width: this.canvas.width, height: this.canvas.height };
    this.scene = config ? { width: clamp(Math.round(config.width), 32, 1600), height: clamp(Math.round(config.height), 32, 1600), mode: config.mode === 'cover' ? 'cover' : 'fit', color: config.color || '#ffffff' } : null;
    this.layout(); if (resizeLayers) this.rescaleLayers(previous);
    this.paintMedia(); this.fit(); this.commit(); this.emit('adjust'); this.emit('layers'); this.emit('media');
  }

  pose(obj = this.selected()) {
    if (!obj) throw new Error('Select a layer first.');
    return Object.fromEntries(['left', 'top', 'scaleX', 'scaleY', 'angle', 'opacity'].map((key) => [key, obj[key]]));
  }

  capturePose(role) {
    if (!this.isAnimated) throw new Error('Poses need a GIF.');
    const obj = this.selected(); if (!obj) throw new Error('Select a layer first.');
    this.pause(); const current = this.pose(obj);
    const config = obj.mfAnimation?.kind === 'poses' ? obj.mfAnimation : {};
    obj.mfAnimation = { ...config, kind: 'poses', easing: config.easing || 'smooth', duration: config.duration || 0, [role]: current };
    this.applyFrame(); this.commit(); this.emit('layers'); this.emit('frame');
  }

  setMaskDrawing(config, width = 24) {
    this.setDrawing('pen', '#8b5cf6', width);
    this.maskDrawing = { ...config }; this.canvas.freeDrawingBrush.color = '#8b5cf680';
  }

  loopFrames({ pingpong = false, hold = 0, transition = 0, delay = 40 } = {}) {
    if (!this.isAnimated) throw new Error('Load a GIF first.');
    this.pause();
    const frames = this.media.frames, baseCount = frames.length;
    transition = clamp(Math.round(transition), 0, 60); hold = clamp(Number(hold) || 0, 0, 5000); delay = clamp(Number(delay) || 40, 10, 1000);
    const expected = baseCount + (pingpong ? Math.max(0, baseCount - 2) : 0) + transition + (frames.at(-1).delay + hold > 10000 ? 1 : 0);
    if (this.media.originalFrames.length + transition > 1200) throw new Error('The project supports at most 1200 source frames.');
    if (expected > 1200) throw new Error('The loop would exceed 1200 frames. Trim it first.');
    const bytes = this.media.originalFrames.reduce((n, f) => n + f.canvas.width * f.canvas.height * 4, 0) + this.media.width * this.media.height * transition * 4;
    if (bytes > 192 * 1024 * 1024) throw new Error('The transition exceeds the frame memory budget. Use fewer frames.');
    const copy = (frame) => {
      const f = { ...frame, id: uid() };
      if (this.frameAdjust[frame.id]) this.frameAdjust[f.id] = clone(this.frameAdjust[frame.id]);
      for (const obj of this.walkObjects()) {
        if (obj.mfFrameIds?.includes(frame.id)) obj.mfFrameIds.push(f.id);
        if (obj.mfOverrides?.[frame.id]) obj.mfOverrides[f.id] = clone(obj.mfOverrides[frame.id]);
      }
      return f;
    };
    const plan = frames.map((f) => ({ ...f }));
    if (pingpong) plan.push(...frames.slice(1, -1).reverse().map(copy));
    if (hold) {
      const total = plan.at(-1).delay + hold;
      plan.at(-1).delay = Math.min(10000, total);
      if (total > 10000) { const extra = copy(plan.at(-1)); extra.delay = total - 10000; plan.push(extra); }
    }
    const last = plan.at(-1), first = plan[0];
    this.media.generatedFrames ||= [];
    for (let i = 1; i <= transition; i++) {
      const c = document.createElement('canvas'); c.width = this.media.width; c.height = this.media.height;
      const ctx = c.getContext('2d'), alpha = i / (transition + 1);
      ctx.drawImage(last.canvas, 0, 0, c.width, c.height); ctx.globalAlpha = alpha; ctx.drawImage(first.canvas, 0, 0, c.width, c.height);
      const f = copy(last); f.canvas = c; f.sourceIndex = this.media.originalFrames.length; f.delay = delay;
      this.media.originalFrames.push({ canvas: c }); this.media.generatedFrames.push(c.toDataURL('image/png')); plan.push(f);
    }
    this.media.frames = plan; this.seek(0); this.commit(); this.emit('timeline');
  }

  arrange(objects, action) {
    if (!objects.length) throw new Error('Select layers first.');
    this.pause(); this.canvas.discardActiveObject();
    const bounds = objects.map((obj) => ({ obj, b: obj.getBoundingRect() }));
    const minX = Math.min(...bounds.map(({ b }) => b.left)), maxX = Math.max(...bounds.map(({ b }) => b.left + b.width));
    const minY = Math.min(...bounds.map(({ b }) => b.top)), maxY = Math.max(...bounds.map(({ b }) => b.top + b.height));
    const move = (obj, dx, dy) => { obj.set({ left: obj.left + dx, top: obj.top + dy }); this.rememberObject(obj, ['left', 'top']); obj.setCoords(); };
    if (action.startsWith('distribute')) {
      if (objects.length < 3) throw new Error('Distribution needs at least three layers.');
      const horizontal = action === 'distribute-x', key = horizontal ? 'left' : 'top', dimension = horizontal ? 'width' : 'height';
      bounds.sort((a, b) => a.b[key] - b.b[key]);
      const begin = bounds[0].b[key], end = bounds.at(-1).b[key] + bounds.at(-1).b[dimension];
      const gap = (end - begin - bounds.reduce((n, item) => n + item.b[dimension], 0)) / (bounds.length - 1);
      let at = begin; for (const { obj, b } of bounds) { move(obj, horizontal ? at - b.left : 0, horizontal ? 0 : at - b.top); at += b[dimension] + gap; }
    } else for (const { obj, b } of bounds) {
      const dx = action === 'left' ? minX - b.left : action === 'right' ? maxX - b.left - b.width : action === 'center-x' ? (minX + maxX - b.width) / 2 - b.left : action === 'canvas-x' ? (this.canvas.width - b.width) / 2 - b.left : 0;
      const dy = action === 'top' ? minY - b.top : action === 'bottom' ? maxY - b.top - b.height : action === 'center-y' ? (minY + maxY - b.height) / 2 - b.top : action === 'canvas-y' ? (this.canvas.height - b.height) / 2 - b.top : 0;
      move(obj, dx, dy);
    }
    this.applyFrame(); this.paintMedia(); this.commit(); this.emit('layers');
    if (objects.length === 1) this.canvas.setActiveObject(objects[0]);
    this.emit('selection');
  }

  transformStoredState(obj, from, to) {
    const base = clone(obj.mfBase || this.objectProps(obj));
    const transform = (props) => {
      obj.set({ ...base, ...props }); fabric.util.sendObjectToPlane(obj, from, to);
      return this.objectProps(obj);
    };
    const nextBase = transform(base), overrides = {};
    for (const [id, props] of Object.entries(obj.mfOverrides || {})) overrides[id] = transform(props);
    if (obj.mfAnimation?.kind === 'poses') for (const role of ['start', 'end']) {
      if (obj.mfAnimation[role]) { const value = transform(obj.mfAnimation[role]); obj.mfAnimation[role] = Object.fromEntries(Object.keys(obj.mfAnimation[role]).map((key) => [key, value[key]])); }
    }
    obj.mfBase = nextBase; obj.mfOverrides = overrides; obj._motion = null; obj.set(nextBase);
  }

  groupLayers(objects) {
    if (objects.length < 2) throw new Error('Select at least two layers.');
    const order = this.canvas.getObjects(), insertion = Math.min(...objects.map((obj) => order.indexOf(obj)));
    objects = order.filter((obj) => objects.includes(obj));
    this.pause(); this.canvas.discardActiveObject(); this.restoring = true;
    let group;
    try {
      this.canvas.remove(...objects);
      group = new fabric.Group(objects, { mfKind: 'group', mfName: 'Group', objectCaching: false, subTargetCheck: false, layoutManager: new fabric.LayoutManager(new fabric.FixedLayout()) });
      const matrix = group.calcTransformMatrix();
      for (const obj of objects) this.transformStoredState(obj, undefined, matrix);
      group.mfBase = this.objectProps(group); this.canvas.insertAt(insertion, group); this.canvas.setActiveObject(group);
    } finally { this.restoring = false; }
    this.applyFrame(); this.paintMedia(); this.commit(); this.emit('layers'); this.emit('selection'); return group;
  }

  ungroupLayer(group = this.selected()) {
    if (!group || group.type !== 'group') throw new Error('Select a group first.');
    this.pause(); this.canvas.discardActiveObject();
    const children = group.getObjects().slice(), states = new Map(children.map((obj) => [obj, []]));
    const originalIndex = this.frameIndex, count = this.isAnimated ? this.media.frames.length : 1;
    for (let i = 0; i < count; i++) {
      this.frameIndex = i; this.applyFrame();
      const matrix = group.calcTransformMatrix();
      for (const obj of children) {
        const saved = this.objectProps(obj); fabric.util.sendObjectToPlane(obj, matrix);
        const world = this.objectProps(obj); world.opacity = obj.opacity * group.opacity; world.visible = obj.visible && group.visible;
        if (obj.strokeUniform) world.strokeWidth = obj.strokeWidth * Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
        states.get(obj).push(world); obj.set(saved); obj.setCoords();
      }
    }
    const insertion = this.canvas.getObjects().indexOf(group); this.restoring = true;
    try {
      group.removeAll(); this.canvas.remove(group);
      children.forEach((obj, index) => {
        const poses = states.get(obj); obj.mfBase = poses[0]; obj.mfOverrides = {}; obj.mfAnimation = null; obj._motion = null;
        delete obj.mfFrameIds; delete obj.mfStart; delete obj.mfEnd;
        if (this.isAnimated) poses.forEach((pose, i) => { if (JSON.stringify(pose) !== JSON.stringify(poses[0])) obj.mfOverrides[this.media.frames[i].id] = pose; });
        obj.set(obj.mfBase); this.canvas.insertAt(insertion + index, obj);
      });
    } finally { this.restoring = false; }
    this.frameIndex = originalIndex; this.applyFrame(); this.paintMedia(); this.commit(); this.emit('layers'); this.emit('selection');
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.pause();
    this.canvas.dispose();
  }
}

export { uid, EXTRA_PROPS };
